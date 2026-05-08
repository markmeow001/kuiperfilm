import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth"

 
const handler = (NextAuth as any)(authOptions)

export { handler as GET, handler as POST }
