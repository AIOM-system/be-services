export interface CreateReceiptItemRequestDto {
  id: string;
  productId: string;
  productCode: number;
  productName: string;
  quantity: number;
  inventory: number;
  actualInventory: number;
  discount: number;
  costPrice: number;
}

export interface UpdateReceiptItemRequestDto {
  id: string;
  productId: string;
  productCode: number;
  productName: string;
  quantity: number;
  inventory: number;
  actualInventory: number;
  discount: number;
  costPrice: number;
}
