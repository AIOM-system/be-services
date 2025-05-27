import "reflect-metadata";

import { Context } from "hono";
import { inject, injectable } from "tsyringe";

import { InsertOrder } from "../../../database/schemas/order.schema.ts";
import { parseBodyJson } from "../../../common/utils/index.ts";

import type {
  CreateOrderRequestDto,
  UpdateOrderRequestDto,
} from "../dtos/order-create.dto.ts";
import { OrderRepository } from "../../../database/repositories/order.repository.ts";

@injectable()
export default class OrderHandler {
  constructor(
    @inject(OrderRepository) private orderRepository: OrderRepository
  ) {}

  async createOrder(ctx: Context) {
    const body = await parseBodyJson<CreateOrderRequestDto>(ctx);
    console.log({ body });
    const {
      customerType,
      paymentMethod,
      note,
      discountAmount,
      totalAmount,
      items,
    } = body;

    const orderData: Partial<InsertOrder> = {
      customerType,
      paymentMethod,
      note,
      discountAmount,
      totalAmount,
      items,
    };

    return ctx.json({
      data: orderData,
      success: true,
      statusCode: 201,
    });
  }

  async updateOrder(ctx: Context) {
    const body = await parseBodyJson<UpdateOrderRequestDto>(ctx);
    console.log({ body });
    const {
      customerType,
      paymentMethod,
      note,
      discountAmount,
      totalAmount,
      items,
    } = body;

    const orderData: Partial<InsertOrder> = {
      customerType,
      paymentMethod,
      note,
      discountAmount,
      totalAmount,
      items,
    };

    return ctx.json({
      data: orderData,
      success: true,
      statusCode: 200,
    });
  }
}
