import { inject, injectable } from "tsyringe";
import { Context } from "hono";
import { eq } from "drizzle-orm";
import dayjs from "dayjs";

import { parseBodyJson, removeEmptyProps } from "../../../common/utils/index.ts";
import {
  InsertReceiptItem,
  receiptItemTable,
  UpdateReceiptItem,
} from "../../../database/schemas/receipt-item.schema.ts";
import { ReceiptItemRepository } from "../../../database/repositories/receipt-item.repository.ts";

@injectable()
export default class ReceiptItemHandler {
  constructor(
    @inject(ReceiptItemRepository) private receiptItemRepository:
      ReceiptItemRepository,
  ) {}

  async createReceiptItem(ctx: Context) {
    const body = await parseBodyJson<InsertReceiptItem>(ctx);

    const { data, error } = await this.receiptItemRepository.createReceiptItem([body]);

    if (!data || error) {
      throw new Error(error);
    }

    return ctx.json({
      data: { id: data[0].id },
      success: true,
      statusCode: 201,
    });
  }

  async updateReceiptItem(ctx: Context) {
    const id = ctx.req.param("id");
    const body = await parseBodyJson<UpdateReceiptItem>(ctx);

    const payloadUpdate = removeEmptyProps(body as unknown as Record<string, unknown>);
    const dataUpdate = {
      ...payloadUpdate,
      updatedAt: dayjs().toISOString(),
    };

    const { data, error } = await this.receiptItemRepository.updateReceiptItem({
      set: dataUpdate,
      where: [eq(receiptItemTable.id, id)],
    });

    if (!data || error) {
      throw new Error(error);
    }

    return ctx.json({
      data: { id },
      success: true,
      statusCode: 201,
    });
  }

  async deleteReceiptItem(ctx: Context) {
    const id = ctx.req.param("id");

    const { data, error } = await this.receiptItemRepository.deleteReceiptItem(id);
    if (!data || error) {
      throw new Error(error);
    }

    return ctx.json({
      data,
      success: true,
      statusCode: 204,
    });
  }
}
