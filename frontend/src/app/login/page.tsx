"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginView } from "@/components/LoginView";
import { useStore } from "@/lib/store";

export default function LoginPage() {
  const router = useRouter();
  const { user } = useStore();

  useEffect(() => {
    if (user) {
      router.push("/");
    }
  }, [user, router]);

  return <LoginView onBack={() => router.push("/")} onSuccess={() => router.push("/")} />;
}
