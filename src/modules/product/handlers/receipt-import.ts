import { singleton, inject } from "tsyringe";
import { Context } from "hono";
import { between, desc, eq, ilike, or } from "drizzle-orm";
import dayjs from "dayjs";

// REPOSITORY
import { ReceiptImportRepository } from "../../../database/repositories/receipt-import.repository.ts";
import { ReceiptItemRepository } from "../../../database/repositories/receipt-item.repository.ts";

// SCHEMA
import {
  InsertReceiptImport,
  receiptImportTable,
  UpdateReceiptImport,
} from "../../../database/schemas/receipt-import.schema.ts";
import { receiptItemTable } from "../../../database/schemas/receipt-item.schema.ts";

// DTO
import {
  CreateReceiptImportRequestDto,
  UpdateReceiptImportRequestDto,
} from "../dtos/receipt-import.dto.ts";

import {
  getPagination,
  getPaginationMetadata,
  parseBodyJson,
} from "../../../common/utils/index.ts";

@singleton()
export default class ReceiptImportHandler {
  constructor(
    @inject(ReceiptImportRepository)
    private receiptRepository: ReceiptImportRepository,
    @inject(ReceiptItemRepository)
    private receiptItemRepository: ReceiptItemRepository
  ) {}

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
      warehouseLocation,
      paymentDate,
      expectedImportDate,
      status,
      items,
    } = body;

    const receiptNumber = `NH${dayjs().format("YYMMDDHHmm")}`;
    const receiptImportData: InsertReceiptImport = {
      receiptNumber,
      note,
      quantity,
      totalAmount,
      totalProduct,
      supplier,
      warehouseLocation,
      paymentDate,
      expectedImportDate,
      status,
      userCreated: userId,
    };
    const { data } = await this.receiptRepository.createReceiptImport(
      receiptImportData
    );

    if (!data.length) {
      throw new Error("Can't create receipt");
    }

    const receiptId = data[0].id;

    // Create receipt items
    const receiptItemsData = items.map((item) => ({
      ...item,
      receiptId,
    }));
    await this.receiptItemRepository.createReceiptItem(receiptItemsData);

    return ctx.json({
      data: { id: receiptId },
      success: true,
      statusCode: 201,
    });
  }

  async updateReceipt(ctx: Context) {
    const id = ctx.req.param("id");
    const body = await parseBodyJson<UpdateReceiptImportRequestDto>(ctx);
    const { items, ...newReceiptImportData } = body;

    const dataUpdate: UpdateReceiptImport = {
      ...newReceiptImportData,
      updatedAt: dayjs().toISOString(),
    };

    const { data } = await this.receiptRepository.updateReceiptImport({
      set: dataUpdate,
      where: [eq(receiptImportTable.id, id)],
    });

    if (!data.length) {
      throw new Error("Can't update receipt import");
    }

    // Delete old receipt items
    await this.receiptItemRepository.deleteReceiptItemByReceiptId(id);

    // Create receipt items
    const receiptItemsData = items.map((item) => ({
      ...item,
      receiptId: id,
    }));

    // return ids[]
    this.receiptItemRepository.createReceiptItem(receiptItemsData);

    return ctx.json({
      data: { id },
      success: true,
      statusCode: 200,
    });
  }

  async deleteReceipt(ctx: Context) {
    const id = ctx.req.param("id");

    const { data } = await this.receiptRepository.deleteReceiptImport(id);
    if (!data.length) {
      throw new Error("Receipt not found");
    }

    // Delete receipt items
    await this.receiptItemRepository.deleteReceiptItemByReceiptId(id);

    return ctx.json({
      data,
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
          supplier: receiptImportTable.supplier,
          warehouseLocation: receiptImportTable.warehouseLocation,
          paymentDate: receiptImportTable.paymentDate,
          expectedImportDate: receiptImportTable.expectedImportDate,
          status: receiptImportTable.status,
          createdAt: receiptImportTable.createdAt,
        },
      });

    if (!receipt) {
      throw new Error("receipt not found");
    }

    const { data: receiptItems } =
      await this.receiptItemRepository.findReceiptItemsByCondition({
        select: {
          id: receiptItemTable.id,
          productCode: receiptItemTable.productCode,
          productName: receiptItemTable.productName,
          quantity: receiptItemTable.quantity,
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
        }
      );

    if (!receipt) {
      throw new Error("receipt not found");
    }

    const { data: receiptItems } =
      await this.receiptItemRepository.findReceiptItemsByCondition({
        select: {
          id: receiptItemTable.id,
          productCode: receiptItemTable.productCode,
          productName: receiptItemTable.productName,
          quantity: receiptItemTable.quantity,
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
          ilike(receiptImportTable.supplier, `%${keyword}%`)
        )
      );
    }

    if (status) {
      filters.push(eq(receiptImportTable.status, status));
    }

    if (importDate) {
      const start = dayjs(importDate).startOf("day").format();
      const end = dayjs(importDate).endOf("day").format();
      filters.push(between(receiptImportTable.expectedImportDate, start, end));
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
          supplier: receiptImportTable.supplier,
          warehouseLocation: receiptImportTable.warehouseLocation,
          paymentDate: receiptImportTable.paymentDate,
          expectedImportDate: receiptImportTable.expectedImportDate,
          status: receiptImportTable.status,
          createdAt: receiptImportTable.createdAt,
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
}
