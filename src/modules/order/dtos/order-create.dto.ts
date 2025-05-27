import { OrderItem } from "../../../common/types/order.d.ts";

export interface CreateOrderRequestDto {
  customerType: string;
  paymentMethod: string;
  note: string;
  discountAmount: number;
  totalAmount: number;
  items: OrderItem[];
}

export type UpdateOrderRequestDto = Partial<CreateOrderRequestDto>;
