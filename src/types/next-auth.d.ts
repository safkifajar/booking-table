/**
 * Augment Auth.js types untuk tambah custom claims.
 *
 * - session.user.id: dari JWT sub
 * - JWT.sub: user id (default sudah ada tapi explicit declaration biar typed)
 *
 * Ref: https://authjs.dev/getting-started/typescript
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id?: string;
    email?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
  }
}
