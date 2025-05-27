import { Hono } from "hono";
import { container } from "tsyringe";

import OrderController from "./order.controller.ts";

export default class OrderModule {
  static init(app: Hono) {
    const controller = container.resolve(OrderController);
    controller.init(app);
  }
}
