"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";

import type { SupplierView } from "@/components/resources/types";
import { SupplierList } from "@/components/suppliers/supplier-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load suppliers");
  return response.json();
};

export default function SuppliersRoute() {
  const { data, mutate } = useSWR<{ suppliers: SupplierView[] }>("/api/suppliers", fetcher);
  const [form, setForm] = useState({
    name: "",
    inn: "",
    contactName: "",
    phone: "",
    email: "",
  });

  async function createSupplier() {
    const response = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        inn: form.inn || null,
        contactName: form.contactName || null,
        phone: form.phone || null,
        email: form.email || null,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось создать поставщика.");
      return;
    }
    await mutate();
    toast.success("Поставщик создан.");
    setForm({ name: "", inn: "", contactName: "", phone: "", email: "" });
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Поставщики</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Название" value={form.name} />
          <Input onChange={(event) => setForm((current) => ({ ...current, inn: event.target.value }))} placeholder="ИНН" value={form.inn} />
          <Input onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} placeholder="Контакт" value={form.contactName} />
          <Input onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Телефон" value={form.phone} />
          <Input onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" value={form.email} />
          <button className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white" onClick={createSupplier} type="button">
            Создать поставщика
          </button>
        </CardContent>
      </Card>

      <SupplierList suppliers={data?.suppliers ?? []} />
    </div>
  );
}
