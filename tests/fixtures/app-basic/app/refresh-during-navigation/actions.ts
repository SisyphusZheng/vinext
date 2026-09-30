"use server";

import { redirect } from "next/navigation";

export async function redirectToTarget() {
  redirect("/refresh-during-navigation/redirect-target");
}

export async function redirectToPush() {
  redirect("/refresh-during-navigation/redirect-push");
}
