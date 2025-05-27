export enum OrderStatus {
  DRAFT = "draft",
  PENDING = "pending",
  PAID = "paid",
  CANCELLED = "cancelled",
  REFUNDED = "refunded",
}

export enum CustomerType {
  LOYAL = "loyal",
  INDIVIDUAL = "individual",
}

export enum PaymentMethod {
  CASH = "cash",
  BANK_TRANSFER = "bank_transfer",
  CREDIT_CARD = "credit_card",
}
