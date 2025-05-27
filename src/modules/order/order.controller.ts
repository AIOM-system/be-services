import "reflect-metadata";

import { Hono } from "hono";
import { inject, injectable } from "tsyringe";

import OrderHandler from "./handlers/order.ts";

@injectable()
export default class OrderController {
  private readonly path = "/api/v1";

  constructor(
    @inject(OrderHandler) private readonly orderHandler: OrderHandler
  ) {}

  init(app: Hono) {
    const route = new Hono();

    route.post("/orders", (c) => this.orderHandler.createOrder(c));
    route.put("/orders", (c) => this.orderHandler.updateOrder(c));

    app.route(this.path, route);
  }
}
