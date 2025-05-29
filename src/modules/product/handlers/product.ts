import { inject, injectable } from "tsyringe";
import { Context } from "hono";
import { desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import * as XLSX from "xlsx";

import { SupplierRepository } from "../../../database/repositories/supplier.repository.ts";
import { ProductRepository } from "../../../database/repositories/product.repository.ts";
import { ReceiptItemRepository } from "../../../database/repositories/receipt-item.repository.ts";
import { ProductInventoryLogRepository } from "../../../database/repositories/product-inventory-log.repository.ts";
import { UserActivityRepository } from "../../../database/repositories/user-activity.repository.ts";

import {
  type InsertProduct,
  type UpdateProduct,
  type ProductWithSuppliers,
  productTable,
} from "../../../database/schemas/product.schema.ts";
import { supplierTable } from "../../../database/schemas/supplier.schema.ts";
import {
  type InsertProductSupplier,
  productSupplierTable,
} from "../../../database/schemas/product-supplier.schema.ts";
import { receiptItemTable } from "../../../database/schemas/receipt-item.schema.ts";

import {
  getPagination,
  getPaginationMetadata,
  isChanged,
  parseBodyJson,
} from "../../../common/utils/index.ts";
import { generateSupplierCode } from "../../supplier/utils/supplier.util.ts";
import type {
  RepositoryOption,
  ResponseType,
} from "../../../common/types/index.d.ts";

import { database } from "../../../common/config/database.ts";
import { decrement, increment } from "../../../database/custom/helpers.ts";
import { ProductStatus } from "../enums/product.enum.ts";

import { InventoryChangeType } from "../../../database/enums/inventory.enum.ts";
import { UserActivityType } from "../../../database/enums/user-activity.enum.ts";
import { PgTx } from "../../../database/custom/data-types.ts";
import type { IProcessProductInventoryChange } from "../dtos/product.dto.ts";

import { getCurrentISODate } from "../../../common/utils/date.ts";

@injectable()
export default class ProductHandler {
  constructor(
    @inject(ProductRepository) private productRepository: ProductRepository,
    @inject(SupplierRepository) private supplierRepository: SupplierRepository,
    @inject(ReceiptItemRepository)
    private receiptItemRepository: ReceiptItemRepository,
    @inject(ProductInventoryLogRepository)
    private productInventoryLogRepository: ProductInventoryLogRepository,
    @inject(UserActivityRepository)
    private userActivityRepository: UserActivityRepository
  ) {}

  async createProduct(ctx: Context) {
    const body = await parseBodyJson<
      InsertProduct & { suppliers?: Array<{ id: string; costPrice: number }> }
    >(ctx);
    const {
      category,
      productName,
      sellingPrice,
      costPrice,
      inventory,
      unit,
      suppliers,
      description,
      warehouse,
      status,
    } = body;

    // Start a transaction to handle both product and supplier relationships
    const result = await database.transaction(async (tx) => {
      // Create product first
      const { data: products } = await this.productRepository.createProduct(
        {
          productName,
          sellingPrice,
          costPrice,
          inventory,
          unit,
          category,
          description,
          warehouse,
          status,
        },
        tx
      );

      if (!products.length) {
        throw new Error("Can't create product");
      }

      const { id: productId, productCode } = products[0];

      // Create product-supplier relationships if suppliers are provided
      if (suppliers && suppliers.length > 0) {
        const productSuppliers: InsertProductSupplier[] = suppliers.map(
          (supplier) => ({
            productId,
            supplierId: supplier.id,
            costPrice: supplier.costPrice,
            createdAt: new Date().toISOString(),
          })
        );

        await tx.insert(productSupplierTable).values(productSuppliers);
      }

      return { id: productId, productCode };
    });

    return ctx.json({
      data: result,
      success: true,
      statusCode: 201,
    });
  }

  async updateProduct(ctx: Context) {
    const id = ctx.req.param("id");
    const body = await parseBodyJson<
      UpdateProduct & { suppliers?: Array<{ id: string; costPrice: number }> }
    >(ctx);
    const jwtPayload = ctx.get("jwtPayload");
    const userId = jwtPayload.sub;

    const {
      productName,
      status,
      category,
      sellingPrice,
      costPrice,
      inventory,
      suppliers,
      description,
      warehouse,
      unit,
    } = body;

    const product = await this.getProductByIdentity(id, {
      select: {
        id: productTable.id,
        inventory: productTable.inventory,
        costPrice: productTable.costPrice,
        sellingPrice: productTable.sellingPrice,
      },
    });

    // Update product details
    const result = await database.transaction(async (tx) => {
      const dataUpdate: Partial<UpdateProduct> = {
        updatedAt: getCurrentISODate(),
      };

      if (productName) dataUpdate.productName = productName;
      if (status) dataUpdate.status = status;
      if (category) dataUpdate.category = category;
      if (sellingPrice) dataUpdate.sellingPrice = sellingPrice;
      if (costPrice) dataUpdate.costPrice = costPrice;
      if (inventory) dataUpdate.inventory = inventory;
      if (description) dataUpdate.description = description;
      if (warehouse) dataUpdate.warehouse = warehouse;
      if (unit) dataUpdate.unit = unit;

      const { error } = await this.productRepository.updateProduct(
        {
          set: dataUpdate,
          where: [eq(productTable.id, id)],
        },
        tx
      );
      if (error) {
        throw new Error(error);
      }

      // Update product-supplier relationships
      if (suppliers !== undefined && suppliers.length) {
        await this.updateProductSuppliers(id, suppliers, tx);
      }

      // Create inventory log
      if (isChanged(product.inventory, inventory)) {
        await this.createProductInventoryLog(
          userId,
          product,
          inventory as number,
          costPrice as number,
          "",
          InventoryChangeType.MANUAL,
          tx
        );
      }

      // Create user activity log
      await this.createUserActivityLog(dataUpdate, product, userId, id, tx);

      return { id };
    });

    return ctx.json({
      data: result,
      success: true,
      statusCode: 200,
    });
  }

  async deleteProduct(ctx: Context) {
    const id = ctx.req.param("id");

    const result = await database.transaction(async (tx) => {
      // Product-supplier relationships will be automatically deleted due to CASCADE
      const { data: product } = await this.productRepository.deleteProduct(
        id,
        tx
      );
      if (!product.length) {
        throw new Error(`Product not found with id: ${id}`);
      }

      return product;
    });

    return ctx.json({
      data: result,
      success: true,
      statusCode: 204,
    });
  }

  async getProductById(ctx: Context) {
    const identifier = ctx.req.param("id");

    const { data: product, error } =
      await this.productRepository.findProductByIdentity(identifier, {
        select: {
          id: productTable.id,
          category: productTable.category,
          productCode: productTable.productCode,
          code: sql`'NK' || LPAD(${productTable.productCode}::text, 5, '0')`,
          productName: productTable.productName,
          unit: productTable.unit,
          sellingPrice: productTable.sellingPrice,
          costPrice: productTable.costPrice,
          inventory: productTable.inventory,
          description: productTable.description,
          imageUrls: productTable.imageUrls,
          warehouse: productTable.warehouse,
          status: productTable.status,
          createdAt: productTable.createdAt,
          updatedAt: productTable.updatedAt,
          suppliers: sql`
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'id', s.id,
                    'name', s.name,
                    'costPrice', ps.cost_price
                  )
                )
                FROM ${productSupplierTable} ps
                LEFT JOIN ${supplierTable} s ON s.id = ps.supplier_id
                WHERE ps.product_id = ${productTable.id}
              ),
              '[]'::json
            )
          `,
        },
        withSuppliers: true,
      });

    if (error) {
      throw new Error(error);
    }

    return ctx.json({
      data: product,
      success: true,
      statusCode: 200,
    });
  }

  async getProductsByFilter(ctx: Context) {
    const query = ctx.req.query();
    const categories = ctx.req.queries("categories");
    const suppliers = ctx.req.queries("suppliers");
    const { keyword, status, maxPrice, minPrice, maxInventory } = query;
    const filters: any = [];

    if (keyword) {
      filters.push(
        or(
          ilike(sql`${productTable.productCode}::text`, `%${keyword}%`),
          ilike(productTable.productName, `%${keyword}%`)
        )
      );
    }

    if (categories && categories.length) {
      filters.push(inArray(productTable.category, categories));
    }

    if (suppliers && suppliers.length) {
      filters.push(inArray(productSupplierTable.supplierId, suppliers));
    }

    if (maxPrice) {
      filters.push(lte(productTable.sellingPrice, +maxPrice));
    }

    if (minPrice) {
      filters.push(gte(productTable.sellingPrice, +minPrice));
    }

    if (maxInventory) {
      filters.push(lte(productTable.inventory, +maxInventory));
    }

    if (status) {
      filters.push(eq(productTable.status, status));
    }

    const { page, limit, offset } = getPagination({
      page: +(query.page || 1),
      limit: +(query.limit || 10),
    });

    try {
      const { data: products, count } =
        await this.productRepository.findProductsByCondition({
          select: {
            id: productTable.id,
            category: productTable.category,
            productCode: productTable.productCode,
            code: sql`'NK' || LPAD(${productTable.productCode}::text, 5, '0')`,
            productName: productTable.productName,
            unit: productTable.unit,
            sellingPrice: productTable.sellingPrice,
            costPrice: productTable.costPrice,
            inventory: productTable.inventory,
            description: productTable.description,
            imageUrls: productTable.imageUrls,
            warehouse: productTable.warehouse,
            status: productTable.status,
            createdAt: productTable.createdAt,
            updatedAt: productTable.updatedAt,
            suppliers: sql`
              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object(
                      'id', s.id,
                      'name', s.name,
                      'costPrice', ps.cost_price
                    )
                  )
                  FROM ${productSupplierTable} ps
                  LEFT JOIN ${supplierTable} s ON s.id = ps.supplier_id
                  WHERE ps.product_id = ${productTable.id}
                ),
                '[]'::json
              )
            `,
          },
          where: filters,
          orderBy: [desc(productTable.createdAt)],
          limit,
          offset,
          isCount: true,
          withSuppliers: true,
        });

      const metadata = getPaginationMetadata(page, limit, offset, count!);

      return ctx.json({
        data: products,
        metadata,
        success: true,
        statusCode: 200,
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async getTotalProductAndInventory(ctx: Context) {
    const [totalProduct, totalInventory] = await Promise.all([
      this.productRepository.getTotalProducts(),
      this.productRepository.getTotalInventory(),
    ]);

    return ctx.json({
      data: {
        totalProduct,
        totalInventory,
      },
      success: true,
      statusCode: 200,
    });
  }

  async getReceiptHistoryOfProduct(ctx: Context) {
    const query = ctx.req.query();
    const { type, productId, page, limit } = query;
    const filters: any = [eq(receiptItemTable.productId, productId)];

    const {
      page: currentPage,
      limit: take,
      offset,
    } = getPagination({
      page: +(page || 1),
      limit: +(limit || 10),
    });

    const { data, count } =
      await this.receiptItemRepository.findReceiptItemsByProduct(type, {
        select: {},
        where: filters,
        limit: take,
        offset,
        isCount: true,
      });

    const metadata = getPaginationMetadata(currentPage, take, offset, count!);

    return ctx.json({
      data,
      metadata,
      success: true,
      statusCode: 200,
    });
  }

  async getCategories(ctx: Context) {
    const query = ctx.req.query();
    const { keyword, page, limit } = query;
    const filters: any = [];

    if (keyword) {
      filters.push(ilike(productTable.category, `%${keyword}%`));
    }

    const {
      page: currentPage,
      limit: take,
      offset,
    } = getPagination({
      page: +(page || 1),
      limit: +(limit || 10),
    });

    const { data, count } =
      await this.productRepository.findCategoriesByCondition({
        select: {},
        where: filters,
        limit: take,
        offset,
        isCount: true,
      });

    const metadata = getPaginationMetadata(currentPage, take, offset, count!);

    return ctx.json({
      data,
      metadata,
      success: true,
      statusCode: 200,
    });
  }

  async getUnits(ctx: Context) {
    const { data } = await this.productRepository.findUnitByCondition({
      select: {},
      where: [],
    });

    return ctx.json({
      data,
      success: true,
      statusCode: 200,
    });
  }

  async importProducts(ctx: Context) {
    try {
      const body = await ctx.req.parseBody();

      if (body["file"] instanceof File) {
        const file = body["file"];
        console.log(`Processing file: ${file.size} bytes`);

        // Stream processing approach
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const sheetData: any[] = XLSX.utils.sheet_to_json(sheet);

        // Optimize batch size based on data volume
        const batchSize = Math.min(
          1000,
          Math.max(
            100,
            Math.floor(50000 / Object.keys(sheetData[0] || {}).length)
          )
        );
        console.log(
          `Using batch size: ${batchSize}, total rows: ${sheetData.length}`
        );

        console.time("import_product_timer")
        // Pre-process all supplier data to reduce database calls
        const allSupplierNames = new Set<string>();
        sheetData.forEach((row) => {
          const suppliers = row["Nhà Cung Cấp"];
          if (suppliers) {
            suppliers
              .split(";")
              .forEach((name) => allSupplierNames.add(name.trim()));
          }
        });

        let result: ResponseType;

        try {
          await database.transaction(async (tx) => {
            // Bulk create/update all suppliers at once
            const supplierEntries = Array.from(allSupplierNames).map(
              (name) => ({
                code: generateSupplierCode(),
                name,
              })
            );

            // Only process suppliers if there are any
            let supplierNameToId = new Map<string, string>();
            if (supplierEntries.length > 0) {
              const { data: allSuppliers } =
                await this.supplierRepository.createSupplierOnConflictDoUpdate(
                  supplierEntries,
                  tx
                );

              // Create lookup map for all suppliers
              supplierNameToId = new Map(
                allSuppliers.map((supplier) => [supplier.name, supplier.id])
              );
            }

            // Process in batches to avoid memory issues
            for (let i = 0; i < sheetData.length; i += batchSize) {
              const batch = sheetData.slice(i, i + batchSize);

              // Prepare all products in batch
              const productsToCreate = batch.map((row) => ({
                productName: row["Tên hàng"],
                costPrice: row["Giá vốn"],
                sellingPrice: row["Giá bán"],
                inventory: row["Tồn kho"],
                unit: row["ĐVT"],
                category: row["Nhóm hàng"],
                description: row["Mô tả"],
                note: row["Ghi chú"],
                imageUrls: row["Hình ảnh"]?.split(",") ?? [],
                warehouse: row["Vị trí"],
                status: ProductStatus.ACTIVE,
              }));

              // Bulk insert products
              const createdProducts =
                await this.productRepository.createProductOnConflictDoNothing(
                  productsToCreate,
                  tx
                );

              // Prepare all product-supplier relationships
              const allProductSuppliers: InsertProductSupplier[] = [];

              createdProducts.forEach((product, idx) => {
                const row = batch[idx];
                const suppliers = row["Nhà Cung Cấp"];
                const costPrice = row["Giá vốn"];

                if (suppliers && product.id) {
                  const supplierNames = [
                    ...new Set(suppliers.split(";").map((name) => name.trim())),
                  ];

                  supplierNames.forEach((name) => {
                    const supplierId = supplierNameToId.get(name as string);
                    if (supplierId) {
                      allProductSuppliers.push({
                        productId: product.id,
                        supplierId,
                        costPrice,
                      });
                    }
                  });
                }
              });

              // Bulk insert product-supplier relationships if any exist
              if (allProductSuppliers.length > 0) {
                await tx
                  .insert(productSupplierTable)
                  .values(allProductSuppliers);
              }

              console.log(
                `Processed batch ${i / batchSize + 1}/${Math.ceil(
                  sheetData.length / batchSize
                )}`
              );
            }
          });

          result = {
            success: true,
            statusCode: 200,
            message: `Successfully imported ${sheetData.length} products`,
          };
        } catch (txError) {
          console.error("Transaction error:", txError);
          result = {
            success: false,
            message: `Database error: ${(txError as Error).message}`,
            statusCode: 500,
          };
        }

        console.timeEnd("import_product_timer");

        return ctx.json(result);
      } else {
        return ctx.json({
          success: false,
          message: "File not found",
          statusCode: 400,
        });
      }
    } catch (error) {
      console.error("Import error:", error);
      return ctx.json({
        success: false,
        message: (error as Error).message,
        statusCode: 500,
      });
    }
  }

  async exportProductsToExcelFile(ctx: Context) {
    const { data } = await this.productRepository.findProductsByCondition({
      select: {
        id: productTable.id,
        category: productTable.category,
        productCode: productTable.productCode,
        productName: productTable.productName,
        unit: productTable.unit,
        sellingPrice: productTable.sellingPrice,
        costPrice: productTable.costPrice,
        inventory: productTable.inventory,
        description: productTable.description,
        imageUrls: productTable.imageUrls,
        warehouse: productTable.warehouse,
        status: productTable.status,
        createdAt: productTable.createdAt,
        updatedAt: productTable.updatedAt,
      },
      where: [],
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

    // Write workbook to a file
    XLSX.writeFile(workbook, "exported_data.xlsx");

    return ctx.json({
      success: true,
      statusCode: 200,
    });
  }

  async processChangeProductInventory({
    product,
    inventory,
    userId,
    costPrice,
    changeType,
    referenceId,
    tx,
  }: IProcessProductInventoryChange) {
    const productId = product.id;

    await Promise.all([
      this.productRepository.updateProduct(
        {
          set: {
            inventory:
              inventory.type === "increment"
                ? increment(productTable.inventory, inventory.value)
                : decrement(productTable.inventory, inventory.value),
            updatedAt: getCurrentISODate(),
          },
          where: [eq(productTable.id, productId)],
        },
        tx
      ),
      this.createProductInventoryLog(
        userId,
        product,
        inventory.value,
        costPrice,
        referenceId,
        changeType,
        tx
      ),
    ]);
  }

  async getProductByIdentity(
    identity: string,
    opts: Pick<RepositoryOption, "select"> & { withSuppliers?: boolean },
    tx?: PgTx
  ): Promise<ProductWithSuppliers> {
    if (opts.select && !("code" in opts.select)) {
      opts.select = {
        ...opts.select,
        code: sql`'NK' || LPAD(${productTable.productCode}::text, 5, '0')`,
      };
    }

    const { data: product, error } =
      await this.productRepository.findProductByIdentity(identity, opts, tx);

    if (error) {
      throw new Error(error);
    }

    return product;
  }

  /**
   * PRIVATE METHODS
   */

  private async updateProductSuppliers(
    productId: string,
    suppliers: Array<{ id: string; costPrice: number }>,
    tx: PgTx
  ): Promise<void> {
    // Insert new product-supplier relationships
    await tx
      .delete(productSupplierTable)
      .where(eq(productSupplierTable.productId, productId));

    const productSuppliers: InsertProductSupplier[] = suppliers.map(
      (supplier) => ({
        productId,
        supplierId: supplier.id,
        costPrice: supplier.costPrice,
      })
    );

    await tx.insert(productSupplierTable).values(productSuppliers);
  }

  private async createUserActivityLog(
    dataUpdate: Record<string, any>,
    oldData: Record<string, any>,
    userId: string,
    id: string,
    tx: PgTx
  ): Promise<void> {
    if (isChanged(oldData.sellingPrice, dataUpdate.sellingPrice)) {
      await this.userActivityRepository.createActivity(
        {
          userId,
          type: UserActivityType.PRODUCT_SELLING_PRICE_CHANGE,
          description: `Vừa thay đổi giá bán của sản phẩm ${oldData.productCode}`,
          referenceId: id,
        },
        tx
      );
    }

    if (isChanged(oldData.costPrice, dataUpdate.costPrice)) {
      await this.userActivityRepository.createActivity(
        {
          userId,
          type: UserActivityType.PRODUCT_COST_PRICE_CHANGE,
          description: `Vừa thay đổi giá vốn của sản phẩm ${oldData.productCode}`,
          referenceId: id,
        },
        tx
      );
    }
  }

  private async createProductInventoryLog(
    userId: string,
    product: ProductWithSuppliers,
    inventory: number,
    costPrice?: number,
    referenceId?: string,
    changeType?: InventoryChangeType,
    tx?: PgTx
  ) {
    const inventoryChange = (inventory as number) - product.inventory;
    const costPriceChange = (costPrice as number) - product.costPrice;

    await this.productInventoryLogRepository.createLog(
      {
        productId: product.id,
        changeType: changeType || InventoryChangeType.MANUAL,
        previousInventory: product.inventory,
        inventoryChange,
        currentInventory: inventory as number,
        previousCostPrice: product.costPrice,
        costPriceChange: costPrice ? costPriceChange : 0,
        currentCostPrice: costPrice ? costPrice : product.costPrice,
        referenceId,
        userId,
      },
      tx
    );
  }
}
