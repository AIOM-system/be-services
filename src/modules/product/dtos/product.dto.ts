import { PgTx } from "../../../database/custom/data-types.ts";
import { InventoryChangeType } from "../../../database/enums/inventory.enum.ts";
import { ProductWithSuppliers } from "../../../database/schemas/product.schema.ts";

export interface IProcessProductInventoryChange {
  product: ProductWithSuppliers;
  inventory: { value: number; type: "increment" | "decrement" };
  userId: string;
  costPrice?: number;
  changeType?: InventoryChangeType;
  referenceId?: string;
  tx?: PgTx;
}
