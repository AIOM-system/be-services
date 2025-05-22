export interface CreateReceiptItemRequestDto {
  productId: string;
  productName: string;
  productCode: number;
  quantity: number;
  inventory: number;
  actualInventory: number;
  discount: number;
  costPrice: number;
}

export interface UpdateReceiptItemRequestDto {
  productId: string;
  productCode: number;
  productName: string;
  quantity: number;
  inventory: number;
  actualInventory: number;
  discount: number;
  costPrice: number;
}
