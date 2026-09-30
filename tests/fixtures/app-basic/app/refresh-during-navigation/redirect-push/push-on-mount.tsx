"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect } from "react";

// Starts a navigation from a layout effect, before the commit that rendered
// this page has settled.
export function PushOnMount() {
  const router = useRouter();
  useLayoutEffect(() => {
    router.push("/refresh-during-navigation/redirect-target");
  }, [router]);
  return null;
}
