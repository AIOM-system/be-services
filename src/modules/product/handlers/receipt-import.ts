import { inject, injectable } from "tsyringe";
import { Context } from "hono";
import { between, desc, eq, ilike, or, sql } from "drizzle-orm";
import dayjs from "dayjs";

import { ReceiptImportRepository } from "../../../database/repositories/receipt-import.repository.ts";
import { ReceiptItemRepository } from "../../../database/repositories/receipt-item.repository.ts";
import { UserActivityRepository } from "../../../database/repositories/user-activity.repository.ts";
import { ProductRepository } from "../../../database/repositories/product.repository.ts";

import {
  ChangeLog,
  InsertReceiptImport,
  receiptImportTable,
  SelectReceiptImport,
  UpdateReceiptImport,
} from "../../../database/schemas/receipt-import.schema.ts";
import { receiptItemTable } from "../../../database/schemas/receipt-item.schema.ts";
import { supplierTable } from "../../../database/schemas/supplier.schema.ts";
import { productTable } from "../../../database/schemas/product.schema.ts";

import {
  CreateReceiptImportRequestDto,
  UpdateReceiptImportRequestDto,
} from "../dtos/receipt-import.dto.ts";
import { CreateReceiptItemRequestDto } from "../dtos/receipt-item.dto.ts";

import { generateReceiptNumber } from "../utils/receipt-import.util.ts";
import {
  getPagination,
  getPaginationMetadata,
  parseBodyJson,
  removeEmptyProps,
} from "../../../common/utils/index.ts";
import { database } from "../../../common/config/database.ts";
import { PgTx } from "../../../database/custom/data-types.ts";
import { RepositoryOption } from "../../../common/types/index.d.ts";
import { ProductWithSuppliers } from "../../../database/types/product.type.ts";

import { UserActivityType } from "../../../database/enums/user-activity.enum.ts";
import { ReceiptImportStatus } from "../../../database/enums/receipt.enum.ts";
import { increment } from "../../../database/custom/helpers.ts";

import ProductHandler from "./product.ts";

@injectable()
export default class ReceiptImportHandler {
  constructor(
    @inject(ReceiptImportRepository)
    private receiptRepository: ReceiptImportRepository,
    @inject(ReceiptItemRepository)
    private receiptItemRepository: ReceiptItemRepository,
    @inject(ProductRepository) private productRepository: ProductRepository,
    @inject(UserActivityRepository)
    private userActivityRepository: UserActivityRepository,
    @inject(ProductHandler) private productHandler: ProductHandler,
  ) {}

  async importProductQuickly(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const userId = jwtPayload.sub;

    const body = await parseBodyJson<Record<string, string>>(ctx);
    const { code } = body;

    const receiptImport = await database.transaction(async (tx) => {
      let { data: receiptImport } =
        await this.receiptRepository.findReceiptsImportByStatus(
          ReceiptImportStatus.PROCESSING,
          userId,
          {
            select: {
              id: receiptImportTable.id,
              receiptNumber: receiptImportTable.receiptNumber,
              status: receiptImportTable.status,
            },
          },
          tx,
        );

      /**
       * If there is no receipt import, create a new one
       */
      if (receiptImport.length) {
        receiptImport = receiptImport[0];
      } else {
        const { data, error } =
          await this.receiptRepository.createReceiptImport(
            {
              receiptNumber: generateReceiptNumber(),
              status: ReceiptImportStatus.PROCESSING,
              userCreated: userId,
            },
            tx,
          );

        if (error) {
          throw new Error(error);
        }

        receiptImport = data;
      }

      if (!receiptImport) {
        throw new Error("Can't create receipt import");
      }

      const product = await this.getProductByIdentity(
        code,
        {
          select: {
            id: productTable.id,
            productCode: productTable.productCode,
            productName: productTable.productName,
            inventory: productTable.inventory,
            costPrice: productTable.costPrice,
          },
        },
        tx,
      );

      // Upsert receipt item
      const {
        id: productId,
        productCode,
        productName,
        inventory,
        costPrice,
      } = product;

      const receiptItemData = {
        receiptId: receiptImport.id,
        productId,
        productCode,
        productName,
        costPrice,
        inventory,
        actualInventory: inventory + 1,
      };

      await Promise.all([
        this.receiptItemRepository.upsertReceiptItemQuick(receiptItemData, tx),
        this.productRepository.updateProduct(
          {
            set: {
              inventory: increment(productTable.inventory),
              updatedAt: dayjs().toISOString(),
            },
            where: [eq(productTable.id, productId)],
          },
          tx,
        ),
        this.productHandler.createProductInventoryLog(
          userId,
          product,
          inventory + 1,
          costPrice,
          receiptImport.id,
          tx,
        ),
      ]);

      return receiptImport;
    });

    return ctx.json({
      data: { id: receiptImport.id },
      success: true,
      statusCode: 200,
    });
  }

  async createReceipt(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const userId = jwtPayload.sub;

    const body = await parseBodyJson<CreateReceiptImportRequestDto>(ctx);
    const {
      note,
      quantity,
      totalAmount,
      totalProduct,
      supplier,
      warehouse,
      paymentDate,
      importDate,
      status,
      items,
    } = body;

    const receiptId = await database.transaction(async (tx) => {
      const receiptNumber = generateReceiptNumber();
      const receiptImportData: InsertReceiptImport = {
        receiptNumber,
        note,
        quantity,
        totalAmount,
        totalProduct,
        supplier,
        warehouse,
        paymentDate,
        importDate,
        status,
        userCreated: userId,
      };
      const { data, error } = await this.receiptRepository.createReceiptImport(
        receiptImportData,
        tx,
      );

      if (error || !data) {
        throw new Error(error);
      }

      // Create receipt items & user activity
      const receiptId = data.id;

      await Promise.all([
        this.createReceiptItems(receiptId, items, tx),
        this.userActivityRepository.createActivity(
          {
            userId: userId,
            description: `Vừa tạo 1 phiếu nhập ${receiptNumber}`,
            type: UserActivityType.RECEIPT_IMPORT_CREATED,
            referenceId: receiptId,
          },
          tx,
        ),
      ]);

      return receiptId;
    });

    return ctx.json({
      data: { id: receiptId },
      success: true,
      statusCode: 201,
    });
  }

  async updateReceipt(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const id = ctx.req.param("id");
    const body = await parseBodyJson<UpdateReceiptImportRequestDto>(ctx);
    const { items, ...newReceiptData } = body;
    const { fullname } = jwtPayload;

    console.log({ items, newReceiptData });

    const payloadUpdate = removeEmptyProps(newReceiptData);
    const dataUpdate: UpdateReceiptImport = {
      ...payloadUpdate,
      updatedAt: dayjs().toISOString(),
    };

    await database.transaction(async (tx) => {
      const { data: receipt, error } =
        await this.receiptRepository.findReceiptImportById(
          id,
          {
            select: {
              id: receiptImportTable.id,
              status: receiptImportTable.status,
              changeLog: receiptImportTable.changeLog,
            },
          },
          tx,
        );

      if (!receipt) {
        throw new Error(error);
      }

      if (payloadUpdate.status && payloadUpdate.status !== receipt.status) {
        const dataStatus = await this.handleReceiptStatusChange(
          receipt,
          payloadUpdate.status,
          fullname,
          tx,
        );

        dataUpdate.status = dataStatus.status;
        dataUpdate.changeLog = dataStatus.changeLog;
      }

      const { data, error: updateError } =
        await this.receiptRepository.updateReceiptImport(
          {
            set: dataUpdate,
            where: [eq(receiptImportTable.id, id)],
          },
          tx,
        );

      if (!data) {
        throw new Error(updateError);
      }

      if (items && items.length) {
        // Delete old receipt items
        await this.receiptItemRepository.deleteReceiptItemByReceiptId(id, tx);

        // Create receipt items
        await this.createReceiptItems(id, items, tx);
      }
    });

    return ctx.json({
      data: { id },
      success: true,
      statusCode: 200,
    });
  }

  async deleteReceipt(ctx: Context) {
    const id = ctx.req.param("id");

    const result = await database.transaction(async (tx) => {
      const { data } = await this.receiptRepository.deleteReceiptImport(id, tx);
      if (!data.length) {
        throw new Error("Receipt not found");
      }

      // Delete receipt items
      await this.receiptItemRepository.deleteReceiptItemByReceiptId(id, tx);

      return data;
    });

    return ctx.json({
      data: result,
      success: true,
      statusCode: 204,
    });
  }

  async getReceiptById(ctx: Context) {
    const receiptId = ctx.req.param("id");

    const { data: receipt } =
      await this.receiptRepository.findReceiptImportById(receiptId, {
        select: {
          id: receiptImportTable.id,
          receiptNumber: receiptImportTable.receiptNumber,
          note: receiptImportTable.note,
          quantity: receiptImportTable.quantity,
          totalProduct: receiptImportTable.totalProduct,
          totalAmount: receiptImportTable.totalAmount,
          supplier: {
            id: supplierTable.id,
            name: supplierTable.name,
          },
          warehouse: receiptImportTable.warehouse,
          paymentDate: receiptImportTable.paymentDate,
          importDate: receiptImportTable.importDate,
          changeLog: receiptImportTable.changeLog,
          status: receiptImportTable.status,
          createdAt: receiptImportTable.createdAt,
          userCreated: receiptImportTable.userCreated,
        },
      });

    if (!receipt) {
      throw new Error("receipt not found");
    }

    const { data: receiptItems } =
      await this.receiptItemRepository.findReceiptItemsByCondition({
        select: {
          id: receiptItemTable.id,
          code: sql`'NK' || LPAD(${receiptItemTable.productCode}::text, 5, '0')`,
          productId: receiptItemTable.productId,
          productCode: receiptItemTable.productCode,
          productName: receiptItemTable.productName,
          quantity: receiptItemTable.quantity,
          inventory: receiptItemTable.inventory,
          actualInventory: receiptItemTable.actualInventory,
          discount: receiptItemTable.discount,
          costPrice: receiptItemTable.costPrice,
        },
        where: [eq(receiptItemTable.receiptId, receiptId)],
      });

    return ctx.json({
      data: {
        receipt,
        items: receiptItems,
      },
      success: true,
      statusCode: 200,
    });
  }

  async getReceiptItemsByBarcode(ctx: Context) {
    const receiptNumber = ctx.req.param("receiptNumber");

    const { data: receipt } =
      await this.receiptRepository.findReceiptImportByReceiptNumber(
        receiptNumber,
        {
          select: {
            id: receiptImportTable.id,
            receiptNumber: receiptImportTable.receiptNumber,
          },
        },
      );

    if (!receipt) {
      throw new Error("receipt not found");
    }

    const { data: receiptItems } =
      await this.receiptItemRepository.findReceiptItemsByCondition({
        select: {
          id: receiptItemTable.id,
          code: sql`'NK' || LPAD(${receiptItemTable.productCode}::text, 5, '0')`,
          productId: receiptItemTable.productId,
          productCode: receiptItemTable.productCode,
          productName: receiptItemTable.productName,
          quantity: receiptItemTable.quantity,
          inventory: receiptItemTable.inventory,
          actualInventory: receiptItemTable.actualInventory,
          discount: receiptItemTable.discount,
          costPrice: receiptItemTable.costPrice,
        },
        where: [eq(receiptItemTable.receiptId, receipt.id)],
      });

    return ctx.json({
      data: {
        receipt,
        items: receiptItems,
      },
      success: true,
      statusCode: 200,
    });
  }

  async getReceiptsByFilter(ctx: Context) {
    const query = ctx.req.query();

    const { keyword, status, importDate } = query;
    const filters: any = [];

    if (keyword) {
      filters.push(
        or(
          ilike(receiptImportTable.receiptNumber, `%${keyword}%`),
          ilike(receiptImportTable.supplier, `%${keyword}%`),
        ),
      );
    }

    if (status) {
      filters.push(eq(receiptImportTable.status, status));
    }

    if (importDate) {
      const start = dayjs(importDate).startOf("day").format();
      const end = dayjs(importDate).endOf("day").format();
      filters.push(between(receiptImportTable.importDate, start, end));
    }

    const { page, limit, offset } = getPagination({
      page: +(query.page || 1),
      limit: +(query.limit || 10),
    });

    const { data: receipts, count } =
      await this.receiptRepository.findReceiptsImportByCondition({
        select: {
          id: receiptImportTable.id,
          receiptNumber: receiptImportTable.receiptNumber,
          note: receiptImportTable.note,
          quantity: receiptImportTable.quantity,
          totalProduct: receiptImportTable.totalProduct,
          totalAmount: receiptImportTable.totalAmount,
          supplier: {
            id: supplierTable.id,
            name: supplierTable.name,
          },
          warehouse: receiptImportTable.warehouse,
          paymentDate: receiptImportTable.paymentDate,
          importDate: receiptImportTable.importDate,
          status: receiptImportTable.status,
          createdAt: receiptImportTable.createdAt,
          userCreated: receiptImportTable.userCreated,
        },
        where: filters,
        orderBy: [desc(receiptImportTable.createdAt)],
        limit,
        offset,
        isCount: true,
      });

    const metadata = getPaginationMetadata(page, limit, offset, count!);

    return ctx.json({
      data: receipts,
      metadata,
      success: true,
      statusCode: 200,
    });
  }

  async getTotalImportsByDateRange(ctx: Context) {
    const query = ctx.req.query();
    const { startDate, endDate } = query;

    const total = await this.receiptRepository.getTotalImportsByDateRange(
      startDate,
      endDate,
    );

    return ctx.json({
      data: total,
      success: true,
      statusCode: 200,
    });
  }

  /**
   * Private methods
   */

  private async createReceiptItems(
    receiptId: string,
    items: Array<CreateReceiptItemRequestDto>,
    tx: PgTx,
  ): Promise<void> {
    const receiptItemsData = items.map((item) => ({
      productId: item.id,
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      inventory: item.inventory,
      actualInventory: item.actualInventory,
      discount: item.discount,
      costPrice: item.costPrice,
      receiptId,
    }));
    await this.receiptItemRepository.createReceiptItem(receiptItemsData, tx);
  }

  private async getProductByIdentity(
    identifier: string,
    opts: Pick<RepositoryOption, "select"> & { withSuppliers?: boolean },
    tx?: PgTx,
  ): Promise<ProductWithSuppliers> {
    if (opts.select && !("code" in opts.select)) {
      opts.select = {
        ...opts.select,
        code: sql`'NK' || LPAD(${productTable.productCode}::text, 5, '0')`,
      };
    }

    const { data: product, error } =
      await this.productRepository.findProductByIdentity(identifier, opts, tx);

    if (error) {
      throw new Error(error);
    }

    return product;
  }

  private async getReceiptItemsByReceiptId(receiptId: string, tx?: PgTx) {
    const { data: receiptItems } =
      await this.receiptRepository.getReceiptItemsByReceiptId(
        receiptId,
        {
          select: {
            id: receiptItemTable.id,
            productId: receiptItemTable.productId,
            quantity: receiptItemTable.quantity,
            costPrice: receiptItemTable.costPrice,
          },
        },
        tx,
      );

    return receiptItems;
  }

  private async handleReceiptStatusChange(
    receipt: SelectReceiptImport,
    newStatus: ReceiptImportStatus,
    fullname: string,
    tx: PgTx,
  ): Promise<{ changeLog: ChangeLog[]; status: ReceiptImportStatus }> {
    switch (newStatus) {
      case ReceiptImportStatus.WAITING: {
        const receiptItems = await this.getReceiptItemsByReceiptId(
          receipt.id,
          tx,
        );

        if (!receiptItems.length) {
          throw new Error("Không tìm thấy sản phẩm trong phiếu");
        }

        let totalQuantity = 0;
        let totalProduct = 0;
        let totalAmount = 0;

        for (const item of receiptItems) {
          totalQuantity += item.quantity;
          totalProduct += 1;
          totalAmount += item.costPrice * item.quantity;
        }

        const { error } = await this.receiptRepository.updateReceiptImport({
          set: {
            quantity: totalQuantity,
            totalProduct,
            totalAmount,
          },
          where: [eq(receiptImportTable.id, receipt.id)],
        });

        if (error) {
          throw new Error(error);
        }
        break;
      }
      case ReceiptImportStatus.COMPLETED:
        // TODO: create notification
        break;
      default:
        break;
    }

    // Update status change logs
    const changeLog = receipt.changeLog || [];
    changeLog.push({
      user: fullname,
      oldStatus: receipt.status as ReceiptImportStatus,
      newStatus,
      timestamp: dayjs().toISOString(),
    });

    return {
      changeLog,
      status: newStatus,
    };
  }
}
