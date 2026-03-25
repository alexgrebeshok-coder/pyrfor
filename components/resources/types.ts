export interface EquipmentView {
  id: string;
  name: string;
  type: string;
  model: string | null;
  serialNumber: string | null;
  status: string;
  projectId: string | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  project: { id: string; name: string } | null;
  assignments: Array<{
    id: string;
    projectId: string;
    startDate: string;
    endDate: string | null;
    hoursUsed: number;
    project: { id: string; name: string };
  }>;
}

export interface MaterialView {
  id: string;
  name: string;
  unit: string;
  category: string;
  currentStock: number;
  minStock: number;
  unitPrice: number | null;
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  movements: Array<{
    id: string;
    projectId: string;
    type: string;
    quantity: number;
    unitPrice: number | null;
    date: string;
    project: { id: string; name: string };
  }>;
}

export interface SupplierView {
  id: string;
  name: string;
  inn: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  _count?: {
    contracts: number;
    materials: number;
    expenses: number;
  };
}

export interface ContractView {
  id: string;
  number: string;
  title: string;
  type: string;
  supplierId: string;
  projectId: string;
  amount: number;
  paidAmount: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: string;
  documentUrl: string | null;
  supplier: { id: string; name: string };
  project: { id: string; name: string };
}
