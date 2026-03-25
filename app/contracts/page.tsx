"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { ContractList } from "@/components/contracts/contract-list";
import type { ContractView, SupplierView } from "@/components/resources/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, fieldStyles } from "@/components/ui/field";
import { useProjects } from "@/lib/hooks/use-api";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load contracts");
  return response.json();
};

export default function ContractsRoute() {
  const { projects } = useProjects();
  const { data, mutate } = useSWR<{ contracts: ContractView[] }>("/api/contracts", fetcher);
  const { data: suppliersResponse } = useSWR<{ suppliers: SupplierView[] }>("/api/suppliers", fetcher);
  const suppliers = suppliersResponse?.suppliers ?? [];
  const [form, setForm] = useState({
    number: "",
    title: "",
    type: "supply",
    supplierId: "",
    projectId: "",
    amount: "",
    paidAmount: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
  });

  async function createContract() {
    const response = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        amount: Number(form.amount),
        paidAmount: form.paidAmount ? Number(form.paidAmount) : 0,
        currency: "RUB",
        startDate: `${form.startDate}T00:00:00.000Z`,
        endDate: `${form.endDate}T00:00:00.000Z`,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось создать договор.");
      return;
    }
    await mutate();
    toast.success("Договор создан.");
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Договоры</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))} placeholder="Номер" value={form.number} />
          <Input onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Название" value={form.title} />
          <Input onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} placeholder="Тип" value={form.type} />
          <select className={`${fieldStyles} h-11 px-3 py-2`} onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value }))} value={form.supplierId}>
            <option value="">Поставщик</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
          <select className={`${fieldStyles} h-11 px-3 py-2`} onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} value={form.projectId}>
            <option value="">Проект</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <Input onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Сумма" type="number" value={form.amount} />
          <Input onChange={(event) => setForm((current) => ({ ...current, paidAmount: event.target.value }))} placeholder="Оплачено" type="number" value={form.paidAmount} />
          <Input onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} type="date" value={form.startDate} />
          <Input onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} type="date" value={form.endDate} />
          <button className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white" onClick={createContract} type="button">
            Создать договор
          </button>
        </CardContent>
      </Card>

      <ContractList contracts={data?.contracts ?? []} />
    </div>
  );
}
