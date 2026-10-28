import { legalDocsLive } from "@/lib/legal";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return <LoginForm requireTerms={legalDocsLive()} />;
}
