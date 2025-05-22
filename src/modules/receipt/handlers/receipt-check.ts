import { inject, singleton } from "tsyringe";
import { Context } from "hono";
import { between, desc, eq, ilike, or, sql, sum } from "drizzle-orm";
import dayjs from "dayjs";

// REPOSITORY
import { ReceiptCheckRepository } from "../../../database/repositories/receipt-check.repository.ts";
import { ReceiptItemRepository } from "../../../database/repositories/receipt-item.repository.ts";
import { ProductRepository } from "../../../database/repositories/product.repository.ts";
import { UserActivityRepository } from "../../../database/repositories/user-activity.repository.ts";

// SCHEMA
import {
  ActivityLog,
  ChangeLog,
  InsertReceiptCheck,
  receiptCheckTable,
  UpdateReceiptCheck,
} from "../../../database/schemas/receipt-check.schema.ts";
import { receiptItemTable } from "../../../database/schemas/receipt-item.schema.ts";
import { supplierTable } from "../../../database/schemas/supplier.schema.ts";
import { productTable } from "../../../database/schemas/product.schema.ts";
import { userTable } from "../../../database/schemas/user.schema.ts";

// DTO
import {
  CreateReceiptCheckRequestDto,
  UpdateBalanceReceiptRequestDto,
  UpdateReceiptCheckRequestDto,
} from "../dtos/receipt-check.dto.ts";

import {
  getObjLength,
  getPagination,
  getPaginationMetadata,
  parseBodyJson,
  removeEmptyProps,
  getNumberFromStringOrThrow,
} from "../../../common/utils/index.ts";
import { increment } from "../../../database/custom/helpers.ts";
import { database } from "../../../common/config/database.ts";

import { UserActivityType } from "../../../database/enums/user-activity.enum.ts";
import { PgTx } from "../../../database/custom/data-types.ts";
import { ReceiptCheckStatus } from "../../../database/enums/receipt.enum.ts";
import { CreateReceiptItemRequestDto } from "../dtos/receipt-item.dto.ts";

@singleton()
export default class ReceiptCheckHandler {
  constructor(
    @inject(ReceiptCheckRepository)
    private receiptRepository: ReceiptCheckRepository,
    @inject(ReceiptItemRepository)
    private receiptItemRepository: ReceiptItemRepository,
    @inject(ProductRepository) private productRepository: ProductRepository,
    @inject(UserActivityRepository)
    private userActivityRepository: UserActivityRepository,
  ) {}

  async createReceipt(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const userId = jwtPayload.sub;

    const body = await parseBodyJson<CreateReceiptCheckRequestDto>(ctx);
    const { periodic, checker, supplier, date, note, items } = body;

    const receiptId = await database.transaction(async (tx) => {
      const receiptNumber = `KIEM${dayjs().format("YYMMDDHHmm")}`;
      const receiptImportData: InsertReceiptCheck = {
        receiptNumber,
        periodic,
        supplier,
        date,
        note,
        status: ReceiptCheckStatus.PENDING,
        checker,
        userCreated: userId,
      };
      const { data, error } = await this.receiptRepository.createReceiptCheck(
        receiptImportData,
        tx,
      );

      if (error || !data) {
        throw new Error(error);
      }

      // Create receipt items
      const receiptId = data.id;
      await this.createReceiptItems(receiptId, items, tx);

      // Create user activity
      await this.userActivityRepository.createActivity(
        {
          userId: userId,
          description: `Vừa tạo 1 phiếu kiểm ${receiptNumber}`,
          type: UserActivityType.RECEIPT_CHECK_CREATED,
          referenceId: receiptId,
        },
        tx,
      );

      return receiptId;
    });

    return ctx.json({
      data: { id: receiptId },
      success: true,
      statusCode: 201,
    });
  }

  addChangeLog(
    changeLog: Array<ChangeLog> = [],
    oldStatus: ReceiptCheckStatus,
    newStatus: ReceiptCheckStatus,
    user: string,
  ) {
    changeLog.push({
      user,
      oldStatus,
      newStatus,
      timestamp: dayjs().toISOString(),
    });
    return changeLog;
  }

  updateActivityLog(
    oldActivities: ActivityLog[],
    dataUpdate: UpdateReceiptCheck,
    user: string,
  ): ActivityLog[] {
    const newActivities = [
      ...(Array.isArray(oldActivities) ? oldActivities : []),
    ];

    for (const [key] of Object.entries(dataUpdate)) {
      let action = "";
      switch (key) {
        case "periodic":
          action = `${user} đã thay đổi đợt kiểm`;
          break;
        case "note":
          action = `${user} đã thay đổi ghi chú`;
          break;
        case "warehouse":
          action = `${user} đã thay đổi kho`;
          break;
        case "supplier":
          action = `${user} đã thay đổi nhà cung cấp`;
          break;
        case "date":
          action = `${user} đã thay đổi ngày kiểm`;
          break;
        case "status":
          action = `${user} đã thay đổi trạng thái`;
          break;
        case "checker":
          action = `${user} đã thay đổi người kiểm`;
          break;
        default:
          continue;
      }

      newActivities.push({
        user,
        action,
        timestamp: dayjs().toISOString(),
      });
    }

    return newActivities;
  }

  async updateBalanceReceipt(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const id = ctx.req.param("id");
    const body = await parseBodyJson<UpdateBalanceReceiptRequestDto>(ctx);
    const { items } = body;
    const { fullname } = jwtPayload;

    await database.transaction(async (tx) => {
      const { data: receipt } =
        await this.receiptRepository.findReceiptCheckById(id, {
          select: {
            status: receiptCheckTable.status,
            changeLog: receiptCheckTable.changeLog,
            activityLog: receiptCheckTable.activityLog,
          },
        });

      if (!receipt) {
        throw new Error("Receipt not found");
      }

      const dataUpdate: UpdateReceiptCheck = {
        status: ReceiptCheckStatus.BALANCED,
        updatedAt: dayjs().toISOString(),
      };

      // Update change status log
      const newChangeLog = this.addChangeLog(
        receipt.changeLog,
        receipt.status,
        ReceiptCheckStatus.BALANCED,
        fullname,
      );
      dataUpdate.changeLog = newChangeLog;

      // Update activity logs
      dataUpdate.activityLog = this.updateActivityLog(
        receipt.activityLog,
        { status: ReceiptCheckStatus.BALANCED },
        fullname,
      );

      const { data: resultUpdateReceipt } =
        await this.receiptRepository.updateReceiptCheck(
          {
            set: dataUpdate,
            where: [eq(receiptCheckTable.id, id)],
          },
          tx,
        );

      if (!resultUpdateReceipt.length) {
        throw new Error("Can't update receipt check");
      }

      const asyncUpdateProductInventory = items.map((item) => {
        return this.productRepository.updateProduct(
          {
            where: [eq(productTable.id, item.productId)],
            set: {
              inventory: item.actualInventory,
              updatedAt: dayjs().toISOString(),
            },
          },
          tx,
        );
      });

      await Promise.all(asyncUpdateProductInventory);
    });

    return ctx.json({
      success: true,
      statusCode: 200,
    });
  }

  async updateReceipt(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const id = ctx.req.param("id");
    const body = await parseBodyJson<UpdateReceiptCheckRequestDto>(ctx);
    const { items, ...newReceiptData } = body;
    const { fullname } = jwtPayload;

    const payloadUpdate = removeEmptyProps(newReceiptData);
    const dataUpdate: UpdateReceiptCheck = {
      ...payloadUpdate,
      updatedAt: dayjs().toISOString(),
    };

    await database.transaction(async (tx) => {
      const { data: receipt, error } =
        await this.receiptRepository.findReceiptCheckById(id, {
          select: {
            status: receiptCheckTable.status,
            changeLog: receiptCheckTable.changeLog,
            activityLog: receiptCheckTable.activityLog,
          },
        });

      if (!receipt || error) {
        throw new Error(error);
      }

      // Update change status log
      if (payloadUpdate.status && payloadUpdate.status !== receipt.status) {
        const newChangeLog = this.addChangeLog(
          receipt.changeLog,
          receipt.status,
          payloadUpdate.status,
          fullname,
        );
        dataUpdate.changeLog = newChangeLog;
      }

      // Update activity logs
      if (getObjLength(payloadUpdate)) {
        dataUpdate.activityLog = this.updateActivityLog(
          receipt.activityLog,
          payloadUpdate,
          fullname,
        );
      }

      const { data } = await this.receiptRepository.updateReceiptCheck(
        {
          set: dataUpdate,
          where: [eq(receiptCheckTable.id, id)],
        },
        tx,
      );

      if (!data.length) {
        throw new Error("Can't update receipt check");
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
      const { data } = await this.receiptRepository.deleteReceiptCheck(id, tx);
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

    const { data: receipt } = await this.receiptRepository.findReceiptCheckById(
      receiptId,
      {
        select: {
          id: receiptCheckTable.id,
          receiptNumber: receiptCheckTable.receiptNumber,
          note: receiptCheckTable.note,
          supplier: {
            id: supplierTable.id,
            name: supplierTable.name,
          },
          periodic: receiptCheckTable.periodic,
          date: receiptCheckTable.date,
          status: receiptCheckTable.status,
          checker: receiptCheckTable.checker,
          changeLog: receiptCheckTable.changeLog,
          activityLog: receiptCheckTable.activityLog,
          createdAt: receiptCheckTable.createdAt,
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
          productId: receiptItemTable.productId,
          productCode: receiptItemTable.productCode,
          productName: receiptItemTable.productName,
          quantity: receiptItemTable.quantity,
          costPrice: receiptItemTable.costPrice,
          systemInventory: sum(receiptItemTable.inventory).mapWith(Number),
          actualInventory:
            sql<number>`COALESCE(SUM(${receiptItemTable.actualInventory}), 0)`.mapWith(
              Number,
            ),
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
      await this.receiptRepository.findReceiptCheckByReceiptNumber(
        receiptNumber,
        {
          select: {
            id: receiptCheckTable.id,
            receiptNumber: receiptCheckTable.receiptNumber,
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
          productId: receiptItemTable.productId,
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

    const { keyword, status, date, startDate, endDate } = query;
    const filters: any = [];

    if (keyword) {
      filters.push(
        or(
          ilike(receiptCheckTable.receiptNumber, `%${keyword}%`),
          ilike(receiptCheckTable.note, `%${keyword}%`),
        ),
      );
    }

    if (status) {
      filters.push(eq(receiptCheckTable.status, status));
    }

    if (date) {
      const start = dayjs(date).startOf("day").format();
      const end = dayjs(date).endOf("day").format();
      filters.push(between(receiptCheckTable.date, start, end));
    }

    if (startDate && endDate) {
      const start = dayjs(startDate).startOf("day").format();
      const end = dayjs(endDate).endOf("day").format();
      filters.push(between(receiptCheckTable.date, start, end));
    }

    const { page, limit, offset } = getPagination({
      page: +(query.page || 1),
      limit: +(query.limit || 10),
    });

    let { data: receipts, count } =
      await this.receiptRepository.findReceiptsCheckByCondition({
        select: {
          id: receiptCheckTable.id,
          receiptNumber: receiptCheckTable.receiptNumber,
          note: receiptCheckTable.note,
          supplier: {
            id: supplierTable.id,
            name: supplierTable.name,
          },
          periodic: receiptCheckTable.periodic,
          checker: {
            fullname: userTable.fullname,
          },
          systemInventory: sum(receiptItemTable.inventory).mapWith(Number),
          actualInventory:
            sql<number>`COALESCE(SUM(${receiptItemTable.actualInventory}), 0)`.mapWith(
              Number,
            ),
          totalDifference:
            sql<number>`COALESCE(SUM(${receiptItemTable.actualInventory} - ${receiptItemTable.inventory}), 0)`.mapWith(
              Number,
            ),
          totalValueDifference:
            sql<number>`COALESCE(SUM((${receiptItemTable.actualInventory} - ${receiptItemTable.inventory}) * ${receiptItemTable.costPrice}), 0)`.mapWith(
              Number,
            ),
          date: receiptCheckTable.date,
          status: receiptCheckTable.status,
          createdAt: receiptCheckTable.createdAt,
        },
        where: filters,
        orderBy: [desc(receiptCheckTable.createdAt)],
        limit,
        offset,
        isCount: true,
      });

    const metadata = getPaginationMetadata(page, limit, offset, count!);

    if (receipts.length) {
      const receiptItemsAsync = receipts.map(async (receipt) => {
        const { data: receiptItems, count } =
          await this.receiptItemRepository.findReceiptItemsByCondition({
            select: {
              id: receiptItemTable.id,
              productId: receiptItemTable.productId,
              productName: receiptItemTable.productName,
              quantity: receiptItemTable.quantity,
              inventory: receiptItemTable.inventory,
              costPrice: receiptItemTable.costPrice,
              systemInventory: sum(receiptItemTable.inventory).mapWith(Number),
              actualInventory:
                sql<number>`COALESCE(SUM(${receiptItemTable.actualInventory}), 0)`.mapWith(
                  Number,
                ),
            },
            where: [eq(receiptItemTable.receiptId, receipt.id)],
            isCount: true,
            limit: 2,
          });

        return {
          ...receipt,
          items: receiptItems || [],
          totalItems: count,
        };
      });

      receipts = await Promise.all(receiptItemsAsync);
    }

    return ctx.json({
      data: receipts,
      metadata,
      success: true,
      statusCode: 200,
    });
  }

  async updateActualInventoryByReceiptItem(ctx: Context) {
    const receiptId = ctx.req.param("id");
    const productCode = ctx.req.param("productCode");

    const code = getNumberFromStringOrThrow(productCode);

    await this.receiptItemRepository.updateReceiptItem({
      where: [
        eq(receiptItemTable.receiptId, receiptId),
        eq(receiptItemTable.productCode, code),
      ],
      set: {
        actualInventory: increment(receiptItemTable.actualInventory),
      },
    });

    return ctx.json({
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
      productId: item.productId,
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
}
