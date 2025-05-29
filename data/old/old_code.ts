async importProducts(ctx: Context) {
  try {
    // const query = ctx.req.query();
    const body = await ctx.req.parseBody();

    if (body["file"] instanceof File) {
      const file = body["file"];
      console.log(`Got file sized: ${file.size}`);

      console.group("Group Import products");
      console.profile("Profile Import products");
      console.time("Time Import products");
      const result: ResponseType = await new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = async (event: ProgressEvent<FileReader>) => {
          if (!event.target) {
            return resolve({
              success: false,
              message: "Event target not found",
              statusCode: 500,
            });
          }

          const workbook = XLSX.read(event.target.result, { type: "binary" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const sheetData: any[] = XLSX.utils.sheet_to_json(sheet);
          console.log({ SHEET_DATA_LENGTH: sheetData.length });

          const batchSize = 500;
          const batches: any[] = [];

          for (let i = 0; i < sheetData.length; i += batchSize) {
            batches.push(sheetData.slice(i, i + batchSize));
          }

          await database.transaction(async (tx) => {
            for (const batch of batches) {
              const productsAsync = batch.map(async (row) => {
                const costPrice = row["Giá vốn"];
                const suppliers = row["Nhà Cung Cấp"];
                let productSuppliers: InsertProductSupplier[] = [];

                if (suppliers) {
                  // Split and get unique supplier names
                  const supplierNames = [
                    ...new Set(
                      suppliers.split(";").map((name) => name.trim())
                    ),
                  ] as string[];

                  // First, collect all unique suppliers and create/update them in a single batch
                  const uniqueSuppliers = new Map();
                  for (const name of supplierNames) {
                    if (!uniqueSuppliers.has(name)) {
                      uniqueSuppliers.set(name, {
                        code: generateSupplierCode(),
                        name,
                      });
                    }
                  }

                  // Create/update all suppliers at once
                  const { data: newSuppliers } =
                    await this.supplierRepository.createSupplierOnConflictDoUpdate(
                      Array.from(uniqueSuppliers.values()),
                      tx
                    );

                  // Map supplier names to their IDs for later use
                  const supplierNameToId = new Map(
                    newSuppliers.map((supplier, index) => [
                      Array.from(uniqueSuppliers.keys())[index],
                      supplier.id,
                    ])
                  );

                  // Now map the original supplier names to their IDs and cost prices
                  productSuppliers = supplierNames.map((name) => ({
                    productId: "",
                    supplierId: supplierNameToId.get(name) as string,
                    costPrice,
                  }));
                }

                const product: Record<string, string | number> = {
                  productName: row["Tên hàng"],
                  costPrice,
                  sellingPrice: row["Giá bán"],
                  inventory: row["Tồn kho"],
                  unit: row["ĐVT"],
                  category: row["Nhóm hàng"],
                  description: row["Mô tả"],
                  note: row["Ghi chú"],
                  imageUrls: row["Hình ảnh"]?.split(",") ?? [],
                  warehouse: row["Vị trí"],
                  status: ProductStatus.ACTIVE,
                };

                return { product, productSuppliers };
              });

              const productsAndSuppliers = await Promise.all(productsAsync);

              // Insert products first
              const createdProducts =
                await this.productRepository.createProductOnConflictDoNothing(
                  productsAndSuppliers.map((item) => item.product),
                  tx
                );

              // Insert product-supplier relationships
              const productSuppliersAsync = createdProducts.map(
                async (product, index) => {
                  const productSuppliers =
                    productsAndSuppliers[index].productSuppliers;

                  if (productSuppliers.length) {
                    const productSupplierValues = productSuppliers.map(
                      (supplier) => ({
                        ...supplier,
                        productId: product.id,
                      })
                    );

                    await tx
                      .insert(productSupplierTable)
                      .values(productSupplierValues);
                  }
                }
              );

              await Promise.all(productSuppliersAsync);
              // End of batch processing
            }
          });

          resolve({
            success: true,
            statusCode: 200,
          });
        };

        reader.readAsArrayBuffer(file);
      });
      console.timeEnd("Time Import products");
      console.profileEnd("Profile Import products");
      console.groupEnd()

      return ctx.json(result);
    } else {
      return ctx.json({
        success: false,
        message: "File not found",
        statusCode: 400,
      });
    }
  } catch (error) {
    return ctx.json({
      success: false,
      message: (error as Error).message,
      statusCode: 500,
      error,
    });
  }
}