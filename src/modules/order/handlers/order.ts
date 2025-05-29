import "reflect-metadata";

import { Context } from "hono";
import { inject, injectable } from "tsyringe";
import { eq } from "drizzle-orm";

import {
  orderTable,
  type SelectOrder,
  type InsertOrder,
  type UpdateOrder,
} from "../../../database/schemas/order.schema.ts";
import { productTable } from "../../../database/schemas/product.schema.ts";
import { OrderRepository } from "../../../database/repositories/order.repository.ts";

import { database } from "../../../common/config/database.ts";
import { OrderStatus } from "../../../database/enums/order.enum.ts";
import { InventoryChangeType } from "../../../database/enums/inventory.enum.ts";
import { PgTx } from "../../../database/custom/data-types.ts";

import { parseBodyJson, isChanged } from "../../../common/utils/index.ts";
import { getCurrentISODate } from "../../../common/utils/date.ts";
import { generateOrderCode } from "../utils/order.util.ts";

import ProductHandler from "../../product/handlers/product.ts";

@injectable()
export default class OrderHandler {
  constructor(
    @inject(OrderRepository) private orderRepository: OrderRepository,
    @inject(ProductHandler) private productHandler: ProductHandler
  ) {}

  async createOrder(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const userId = jwtPayload.sub;
    const body = await parseBodyJson<InsertOrder>(ctx);
    const {
      customerType,
      paymentMethod,
      note,
      discountAmount,
      items,
      vatInfo,
      status,
    } = body;

    const order = await database.transaction(async (tx) => {
      const totalAmount = items?.reduce(
        (acc, item) => acc + item.price * item.quantity,
        0
      );
      const code = generateOrderCode();

      const orderData: InsertOrder = {
        code,
        customerType,
        paymentMethod,
        note,
        discountAmount,
        totalAmount,
        items,
        vatInfo,
        status,
      };
      const { data: order, error } = await this.orderRepository.createOrder(
        orderData,
        tx
      );

      if (error || !order) {
        throw new Error(error);
      }

      await this.processStatusChange(order, status as OrderStatus, userId, tx);

      return order;
    });

    return ctx.json({
      data: order,
      success: true,
      statusCode: 201,
    });
  }

  async updateOrder(ctx: Context) {
    const jwtPayload = ctx.get("jwtPayload");
    const userId = jwtPayload.sub;

    const orderId = ctx.req.param("id");
    const body = await parseBodyJson<UpdateOrder>(ctx);

    const {
      customerType,
      paymentMethod,
      note,
      discountAmount,
      items,
      vatInfo,
      status,
    } = body;

    const dataUpdate: UpdateOrder = {
      updatedAt: getCurrentISODate(),
    };

    if (items) {
      const totalAmount = items?.reduce(
        (acc, item) => acc + item.price * item.quantity,
        0
      );
      dataUpdate.totalAmount = totalAmount;
      dataUpdate.items = items;
    }

    if (customerType) dataUpdate.customerType = customerType;
    if (paymentMethod) dataUpdate.paymentMethod = paymentMethod;
    if (note) dataUpdate.note = note;
    if (discountAmount) dataUpdate.discountAmount = discountAmount;
    if (vatInfo) dataUpdate.vatInfo = vatInfo;
    if (status) dataUpdate.status = status;

    const order = await database.transaction(async (tx) => {
      const order = await this.getOrderByIdentifier(orderId, tx);

      console.log({ dataUpdate });
      const { error: updateError } = await this.orderRepository.updateOrder(
        {
          set: dataUpdate,
          where: [eq(orderTable.id, orderId)],
        },
        tx
      );

      if (updateError) {
        throw new Error(updateError);
      }

      if (isChanged(order.status, status)) {
        await this.processStatusChange(
          order,
          status as OrderStatus,
          userId,
          tx
        );
      }

      return order;
    });

    return ctx.json({
      data: { id: order.id, code: order.code, status: order.status },
      success: true,
      statusCode: 200,
    });
  }

  async getOrderById(ctx: Context) {
    const id = ctx.req.param("id");

    const { data: order, error } =
      await this.orderRepository.findOrderByIdentifier(id, {
        select: {
          id: orderTable.id,
          code: orderTable.code,
          customerType: orderTable.customerType,
          paymentMethod: orderTable.paymentMethod,
          note: orderTable.note,
          discountAmount: orderTable.discountAmount,
          totalAmount: orderTable.totalAmount,
          items: orderTable.items,
          vatInfo: orderTable.vatInfo,
          status: orderTable.status,
          createdAt: orderTable.createdAt,
        },
      });

    if (error) {
      throw new Error(error);
    }

    return ctx.json({
      data: order,
      success: true,
      statusCode: 200,
    });
  }

  /**
   * PRIVATE FUNCTIONS
   */

  private async getOrderByIdentifier(
    identity: string,
    tx?: PgTx
  ): Promise<SelectOrder> {
    const { data: order, error } =
      await this.orderRepository.findOrderByIdentifier(
        identity,
        {
          select: {
            id: orderTable.id,
            code: orderTable.code,
            status: orderTable.status,
          },
        },
        tx
      );

    if (error || !order) {
      throw new Error(error);
    }

    return order;
  }

  private async processStatusChange(
    order: SelectOrder,
    newStatus: OrderStatus,
    userId: string,
    tx?: PgTx
  ) {
    switch (newStatus) {
      case OrderStatus.REFUNDED: {
        const asyncUpdateInventoryProduct = order.items.map(async (item) => {
          const product = await this.productHandler.getProductByIdentity(
            item.code,
            {
              select: {
                id: productTable.id,
                productCode: productTable.productCode,
                productName: productTable.productName,
                inventory: productTable.inventory,
                costPrice: productTable.costPrice,
              },
            },
            tx
          );

          return this.productHandler.processChangeProductInventory({
            product,
            inventory: { value: item.quantity, type: "increment" },
            userId,
            changeType: InventoryChangeType.ORDER,
            referenceId: order.id,
            tx,
          });
        });

        await Promise.all(asyncUpdateInventoryProduct);
        break;
      }
      case OrderStatus.PAID: {
        const asyncUpdateInventoryProduct = order.items.map(async (item) => {
          const product = await this.productHandler.getProductByIdentity(
            item.code,
            {
              select: {
                id: productTable.id,
                productCode: productTable.productCode,
                productName: productTable.productName,
                inventory: productTable.inventory,
                costPrice: productTable.costPrice,
              },
            },
            tx
          );

          return this.productHandler.processChangeProductInventory({
            product,
            inventory: { value: item.quantity, type: "decrement" },
            userId,
            changeType: InventoryChangeType.ORDER,
            referenceId: order.id,
            tx,
          });
        });

        await Promise.all(asyncUpdateInventoryProduct);
        break;
      }
      default:
        break;
    }
  }
}
