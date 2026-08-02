import { Prisma } from "@prisma/client";
import { fieldsForModel } from "./fields";
import { encryptArgs, decryptResult } from "./transform";

/**
 * Transparent field-level encryption for the columns listed in `ENCRYPTED_FIELDS`.
 * Routers keep reading and writing plain values; ciphertext never leaves this layer.
 */
export function encryptionExtension(key: Buffer) {
  return Prisma.defineExtension({
    name: "field-encryption",
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          const fields = fieldsForModel(model);
          // `args` is a union over every model/operation; the transform is
          // structural and preserves the shape, so re-assert the original type.
          const next = fields ? (encryptArgs(args, fields, key) as typeof args) : args;
          const result = await query(next);
          // Decrypt unconditionally: a result may carry encrypted rows from an
          // included relation even when the root model has no encrypted fields.
          return decryptResult(result, key);
        },
      },
    },
  });
}
