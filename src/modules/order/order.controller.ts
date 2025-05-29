import "reflect-metadata";

import { Hono } from "hono";
import { inject, injectable } from "tsyringe";

import { authenticate } from "../../common/middlewares/verify-jwt.ts";

import OrderHandler from "./handlers/order.ts";

@injectable()
export default class OrderController {
  private readonly path = "/api/v1";

  constructor(
    @inject(OrderHandler) private readonly orderHandler: OrderHandler
  ) {}

  init(app: Hono) {
    const route = new Hono();

    route.post("/orders", authenticate, (c) => this.orderHandler.createOrder(c));
    route.put("/orders/:id", authenticate, (c) => this.orderHandler.updateOrder(c));
    route.get("/orders/:id", authenticate, (c) => this.orderHandler.getOrderById(c));

    app.route(this.path, route);
  }
}
