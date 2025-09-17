// app/ipd/billing/[ipdId]/page.tsx
"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { toast } from "sonner"
import { useForm, Controller, type SubmitHandler } from "react-hook-form"
import { yupResolver } from "@hookform/resolvers/yup"
import * as yup from "yup"
import { motion, AnimatePresence } from "framer-motion"
import CreatableSelect from "react-select/creatable"
import Select from "react-select"
import {
  Plus,
  ArrowLeft,
  AlertTriangle,
  History,
  Trash,
  Calendar,
  User,
  Phone,
  MapPin,
  CreditCard,
  Bed,
  Users,
  FileText,
  ChevronRight,
  Percent,
  UserPlus,
  X,
  DollarSign,
  Tag,
  Save,
  RefreshCw,
  Search,
  Clock,
  Clipboard,
  CheckCircle,
} from "lucide-react"
import { format, parseISO } from "date-fns"
import { Dialog, Transition } from "@headlessui/react"

// Import your placeholder components
import InvoiceDownload from "./InvoiceDownload"
import BulkServiceModal from "./bulk-service-modal"
import PaymentTab from "./paymenttab"
import ServiceTab from "./servicetab"
import Notetab from "./Notetab"

// Import shared types
import { IDoctor, ParsedServiceItem } from "@/lib/shared-types" // Adjust path as needed

// ===== Type Definitions (Adapted for Supabase) =====
interface PatientDetailSupabase {
  patient_id: number
  name: string
  number: number | null
  age: number | null
  gender: string | null
  address: string | null
  age_unit: string | null
  dob: string | null
  uhid: string
}

interface BedManagementSupabase {
  id: number
  room_type: string
  bed_number: number
  bed_type: string
  status: string
}

// These match the JSON structure in Supabase `payment_detail` and `service_detail` columns
interface PaymentDetailItemSupabase {
  id: string
  amount: number
  createdAt: string
  date: string
  paymentType: string // e.g., "cash", "online"
  transactionType: "advance" | "refund" | "discount" | "settlement" | "deposit" // Renamed from 'type'
  amountType?: "advance" | "deposit" | "settlement" | "refund" | "discount" // New field for clearer categorization
  through?: string // Added 'through' field here
  remark?: string // Optional remark for payment
  discountGivenBy?: string | null; // New field for who gave the discount
}

interface ServiceDetailItemSupabase {
  id: string
  amount: number
  createdAt: string
  doctorName: string
  serviceName: string
  type: "service" | "doctorvisit"
}

// Main IPD Registration record from Supabase, with joined data
interface IPDRegistrationSupabaseJoined {
  ipd_id: number
  admission_source: string | null
  admission_type: string | null
  under_care_of_doctor: string | null
  payment_detail: PaymentDetailItemSupabase[] | null // Updated to include 'through' and new type
  bed_id: bigint | null // Supabase returns bigint for numeric IDs
  service_detail: ServiceDetailItemSupabase[] | null
  created_at: string
  discharge_date: string | null
  relative_name: string | null
  relative_ph_no: number | null
  relative_address: string | null
  admission_date: string | null
  admission_time: string | null
  uhid: string
  patient_detail: PatientDetailSupabase | null
  bed_management: BedManagementSupabase | null
  billno?: number | null // <-- Add this line
  ipd_notes?: string | null // Add ipd_notes field
}

// Consolidated BillingRecord for UI state, similar to your Firebase structure
export interface BillingRecord {
  patientId: string
  uhid: string
  ipdId: string
  name: string
  mobileNumber: string
  address?: string | null
  age?: number | null
  ageUnit?: string | null
  gender?: string | null
  dob?: string | null
  relativeName?: string | null
  relativePhone?: number | null
  relativeAddress?: string | null
  dischargeDate?: string | null
  totalDeposit: number
  roomType?: string | null
  bedNumber?: number | string | null
  bedType?: string | null
  services: ServiceDetailItemSupabase[]
  payments: PaymentDetailItemSupabase[] // Updated to use new PaymentDetailItemSupabase
  discount: number // Calculated from payment_detail entries
  admitDate?: string | null
  admissionTime?: string | null
  createdAt?: string
  doctor?: string | null
  billNumber?: number | null // <-- Correct type
  ipdNotes?: string | null // Add ipdNotes to BillingRecord
  discountGivenBy?: string | null; // Add discountGivenBy to BillingRecord
}

// MasterServiceOption - Now without is_consultant and doctor_id (as they are removed from DB)
export interface MasterServiceOption {
  value: string // MasterService.id (UUID, string)
  label: string
  amount: number
}

// ===== Form Interfaces =====
interface AdditionalServiceForm {
  serviceName: string
  amount: number
  quantity: number
}

interface PaymentForm {
  paymentAmount: number
  paymentType: string // "cash", "online"
  transactionType: "advance" | "refund" | "settlement" | "deposit" // Type of financial transaction
  sendWhatsappNotification: boolean
  paymentDate: string
  through?: string // Added 'through' field here
  remark?: string | null; // Optional remark for payment, can be string, undefined, or null
}

interface DiscountForm {
  discountAmount: number
  discountGivenBy?: string | null; // New field for who gave the discount
  otherDiscountGivenBy?: string | null; // New field for custom discount giver name
}

interface DoctorVisitForm {
  doctorId?: number | null
  visitCharge: number
  visitTimes: number
  customDoctorName?: string
  isCustomDoctor: boolean
}

// ===== Validation Schemas =====
const additionalServiceSchema = yup
  .object({
    serviceName: yup.string().required("Service Name is required"),
    amount: yup
      .number()
      .typeError("Amount must be a number")
      .positive("Must be positive")
      .required("Amount is required"),
    quantity: yup
      .number()
      .typeError("Quantity must be an integer")
      .integer("Quantity must be an integer")
      .min(1, "Quantity must be at least 1")
      .required("Quantity is required"),
  })
  .required()

const paymentSchema = yup
  .object({
    paymentAmount: yup
      .number()
      .typeError("Amount must be a number")
      .positive("Must be positive")
      .required("Amount is required"),
    paymentType: yup.string().required("Payment Type is required"),
    transactionType: yup.string().oneOf(["advance", "refund", "settlement", "deposit"]).required("Type is required"), // Updated
    sendWhatsappNotification: yup.boolean().required(),
    paymentDate: yup.string().required("Payment Date is required"),
    through: yup.string().when("paymentType", {
      is: (paymentType: string) => paymentType === "online" || paymentType === "card",
      then: (schema) => schema.required("Through is required for online/card payments"),
      otherwise: (schema) => schema.notRequired(),
    }),
    remark: yup.string().notRequired(), // Optional remark, only string or undefined
  })
  .required()

const discountSchema = yup
  .object({
    discountAmount: yup
      .number()
      .typeError("Discount must be a number")
      .min(0, "Discount cannot be negative")
      .required("Discount is required"),
    discountGivenBy: yup.string().nullable().when("discountAmount", {
      is: (amount: number) => amount > 0,
      then: (schema) => schema.required("Please select who gave the discount"),
      otherwise: (schema) => schema.notRequired().nullable(),
    }),
    otherDiscountGivenBy: yup.string().nullable().when("discountGivenBy", {
      is: "Other",
      then: (schema) => schema.required("Please enter the name of the person"),
      otherwise: (schema) => schema.notRequired().nullable(),
    }),
  })
  .required()

const doctorVisitSchema = yup
  .object({
    doctorId: yup.number().nullable().when("isCustomDoctor", {
      is: false,
      then: (schema) => schema.required("Select a doctor").typeError("Doctor is required"),
      otherwise: (schema) => schema.nullable(),
    }),
    visitCharge: yup
      .number()
      .typeError("Visit charge must be a number")
      .positive("Must be positive")
      .required("Charge is required"),
    visitTimes: yup
      .number()
      .typeError("Visit times must be a number")
      .integer("Visit times must be an integer")
      .min(1, "Must be at least 1")
      .max(10, "Cannot exceed 10 visits")
      .required("Visit times is required"),
    customDoctorName: yup.string().when("isCustomDoctor", {
      is: true,
      then: (schema) => schema.required("Doctor name is required"),
      otherwise: (schema) => schema.notRequired(),
    }),
    isCustomDoctor: yup.boolean().required(),
  })
  .required()

export default function BillingPage() {
  console.log("BillingPage component rendered")
  const params = useParams()
  const ipdId = params.ipdId as string
  const router = useRouter()

  const [selectedRecord, setSelectedRecord] = useState<BillingRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaymentHistoryOpen, setIsPaymentHistoryOpen] = useState(false)
  const [beds, setBeds] = useState<any>({}) // This is not used in this component, can be removed or typed properly if needed
  const [doctors, setDoctors] = useState<IDoctor[]>([]) // Using imported IDoctor
  const [activeTab, setActiveTab] = useState<"overview" | "services" | "payments" | "consultants" | "note">("overview")
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false)
  const [discountUpdated, setDiscountUpdated] = useState(false)
  const [isBulkServiceModalOpen, setIsBulkServiceModalOpen] = useState(false)
  const [masterServiceOptions, setMasterServiceOptions] = useState<MasterServiceOption[]>([])
  const [ipdNote, setIpdNote] = useState<string>("")
  const [ipdNoteLoading, setIpdNoteLoading] = useState(false)

  // Forms
  const {
    register: registerService,
    handleSubmit: handleSubmitService,
    formState: { errors: errorsService },
    reset: resetService,
    setValue: setValueService,
    control: serviceControl,
  } = useForm<AdditionalServiceForm>({
    resolver: yupResolver(additionalServiceSchema),
    defaultValues: { serviceName: "", amount: 0, quantity: 1 },
  })

  const {
    register: registerPayment,
    handleSubmit: handleSubmitPayment,
    formState: { errors: errorsPayment },
    reset: resetPayment,
    setValue: setValuePayment,
    watch: watchPayment,
  } = useForm<PaymentForm>({
    resolver: yupResolver<PaymentForm>(paymentSchema),
    defaultValues: {
      paymentAmount: 0,
      paymentType: "cash",
      transactionType: "advance", // Default to 'advance'
      sendWhatsappNotification: false,
      paymentDate: format(new Date(), "yyyy-MM-dd"),
      through: "cash", // Default to 'cash' for 'cash' payment type
      remark: "",
    },
  })

  const {
    register: registerDiscount,
    handleSubmit: handleSubmitDiscount,
    formState: { errors: errorsDiscount },
    reset: resetDiscount,
    watch: watchDiscount,
  } = useForm<DiscountForm>({
    resolver: yupResolver(discountSchema),
    defaultValues: { discountAmount: 0, discountGivenBy: "Self", otherDiscountGivenBy: null },
  })

  const {
    register: registerVisit,
    handleSubmit: handleSubmitVisit,
    formState: { errors: errorsVisit },
    reset: resetVisit,
    watch: watchVisit,
    setValue: setVisitValue,
    control: visitControl,
  } = useForm<DoctorVisitForm>({
    resolver: yupResolver(doctorVisitSchema),
    defaultValues: {
      doctorId: null,
      visitCharge: 0,
      visitTimes: 1,
      customDoctorName: "",
      isCustomDoctor: false,
    },
  })

  const watchPaymentType = watchPayment("paymentType");

  // Update 'through' default value when 'paymentType' changes
  useEffect(() => {
    if (watchPaymentType === "cash") {
      setValuePayment("through", "cash");
    } else {
      setValuePayment("through", ""); // Clear for other types
    }
  }, [watchPaymentType, setValuePayment]);

  // --- Data Fetching ---
  const fetchBillingData = useCallback(async () => {
    console.log("fetchBillingData called. ipdId:", ipdId)
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("ipd_registration")
        .select(
          `
          *,
          patient_detail (patient_id, name, number, age, gender, address, age_unit, dob, uhid),
          bed_management (id, room_type, bed_number, bed_type, status)
          `,
        )
        .eq("ipd_id", ipdId)
        .single<IPDRegistrationSupabaseJoined>() // Explicitly type the fetched data

      if (error) {
        console.error("Error fetching IPD record:", error)
        toast.error("Failed to load IPD record.")
        setSelectedRecord(null)
        return
      }
      if (!data) {
        console.log("No IPD record found for ipdId:", ipdId)
        toast.error("IPD record not found.")
        setSelectedRecord(null)
        return
      }

      console.log("Fetched IPD data:", data)
      // Map payments to ensure amountType is present for existing records
      const payments = (data.payment_detail || []).map(p => ({
        ...p,
        amountType: p.amountType || p.transactionType, // Default to transactionType if amountType is missing
      })) as PaymentDetailItemSupabase[]
      const services = (data.service_detail || []) as ServiceDetailItemSupabase[]

      // Calculate totalDeposit and discount from payments array using amountType
      let totalDeposit = 0
      let totalDiscount = 0
      payments.forEach((p) => {
        if (p.amountType === "advance" || p.amountType === "deposit" || p.amountType === "settlement") {
          totalDeposit += p.amount
        } else if (p.amountType === "refund") {
          totalDeposit -= p.amount
        } else if (p.amountType === "discount") {
          totalDiscount += p.amount
        }
      })

      const discountGivenByFromPayments = payments.find(p => p.amountType === "discount")?.discountGivenBy || null;

      const processedRecord: BillingRecord = {
        ipdId: String(data.ipd_id),
        uhid: data.uhid,
        patientId: String(data.patient_detail?.patient_id || "N/A"),
        name: data.patient_detail?.name || "Unknown",
        mobileNumber: data.patient_detail?.number ? String(data.patient_detail.number) : "N/A",
        address: data.patient_detail?.address || null,
        age: data.patient_detail?.age || null,
        ageUnit: data.patient_detail?.age_unit || null,
        gender: data.patient_detail?.gender || null,
        dob: data.patient_detail?.dob || null,
        relativeName: data.relative_name || null,
        relativePhone: data.relative_ph_no || null,
        relativeAddress: data.relative_address || null,
        dischargeDate: data.discharge_date,
        totalDeposit: totalDeposit,
        roomType: data.bed_management?.room_type || null,
        bedNumber: data.bed_management?.bed_number || null,
        bedType: data.bed_management?.bed_type || null,
        services: services,
        payments: payments, // Use the mapped payments
        discount: totalDiscount,
        admitDate: data.admission_date || null,
        admissionTime: data.admission_time || null,
        createdAt: data.created_at,
        doctor: data.under_care_of_doctor || null, // This is a string (doctor's name) from DB
        billNumber: data.billno ?? null, // <-- Add this line
        ipdNotes: data.ipd_notes || null, // Add ipdNotes to BillingRecord
        discountGivenBy: discountGivenByFromPayments, // Assign fetched discountGivenBy
      }
      setSelectedRecord(processedRecord)
      console.log("setSelectedRecord called with:", processedRecord)
      setIpdNote(data.ipd_notes || "")
    } catch (error) {
      console.error("Error in fetchBillingData (catch block):", error)
      toast.error("Error loading billing details.")
      setSelectedRecord(null)
    } finally {
      console.log("fetchBillingData finally block: setLoading(false)")
      setLoading(false)
    }
  }, [ipdId])

  const fetchDoctorsAndMasterServices = useCallback(async () => {
    console.log("fetchDoctorsAndMasterServices called.")
    try {
      // Fetch Doctors
      const { data: doctorsData, error: doctorsError } = await supabase
        .from("doctor")
        .select("id, dr_name, department, specialist, charges")
      if (doctorsError) {
        console.error("Error fetching doctors:", doctorsError)
        toast.error("Failed to load doctor data.")
      } else {
        const mappedDoctors: IDoctor[] = (doctorsData || []).map((doc: any) => ({
          id: Number(doc.id), // Ensure ID is number as per IDoctor interface
          name: doc.dr_name,
          specialist: doc.specialist,
          department: doc.department,
          opdCharge: doc.charges?.opdCharge,
          ipdCharges: doc.charges?.ipdCharges,
        }))
        setDoctors(mappedDoctors)
        console.log("Fetched doctors:", mappedDoctors)
      }

      // Fetch Master Services
      const { data: masterServicesData, error: masterServicesError } = await supabase
        .from("master_services")
        .select("id, service_name, amount") // Only selecting relevant fields now
      if (masterServicesError) {
        console.error("Error fetching master services:", masterServicesError)
        toast.error("Failed to load master service options.")
      } else {
        const mappedMasterServices: MasterServiceOption[] = (masterServicesData || []).map((svc: any) => ({
          value: String(svc.id), // Keep value as string for React-Select
          label: svc.service_name,
          amount: Number(svc.amount),
        }))
        setMasterServiceOptions(mappedMasterServices)
        console.log("Fetched master services:", mappedMasterServices)
      }
    } catch (error) {
      console.error("Error fetching doctors or services (catch block):", error)
    }
  }, [])

  useEffect(() => {
    console.log("Main useEffect triggered. ipdId:", ipdId)
    if (ipdId) {
      fetchBillingData()
      fetchDoctorsAndMasterServices()
    }
  }, [ipdId, fetchBillingData, fetchDoctorsAndMasterServices])

  useEffect(() => {
    console.log("Discount useEffect triggered. selectedRecord:", selectedRecord)
    if (selectedRecord) {
      resetDiscount({ discountAmount: selectedRecord.discount || 0 })
      console.log("resetDiscount called with:", selectedRecord.discount || 0)
    }
  }, [selectedRecord, resetDiscount])

  // Auto-fill visit charge based on selected doctor and room type
  const watchSelectedDoctorId = watchVisit("doctorId")
  const watchIsCustomDoctor = watchVisit("isCustomDoctor")

  useEffect(() => {
    console.log("Doctor visit charge useEffect triggered.")
    if (watchIsCustomDoctor || watchSelectedDoctorId === null || !selectedRecord) return

    const doc = doctors.find((d) => d.id === watchSelectedDoctorId)
    if (!doc) return

    let amount = 0
    // Ensure department is handled correctly (e.g., 'OPD' vs 'opd')
    if (doc.department?.toLowerCase() === "opd") {
      amount = doc.opdCharge ?? 0
    } else {
      if (selectedRecord.roomType && doc.ipdCharges?.[selectedRecord.roomType]) {
        amount = doc.ipdCharges[selectedRecord.roomType]
      }
      if (doc.department?.toLowerCase() === "both" && !amount && doc.opdCharge) {
        amount = doc.opdCharge
      }
    }
    setVisitValue("visitCharge", amount)
    console.log("Set visit charge to:", amount)
  }, [watchSelectedDoctorId, selectedRecord, doctors, setVisitValue, watchIsCustomDoctor])

  // Group services for display
  const getGroupedServices = (services: ServiceDetailItemSupabase[]) => {
    const grouped: Record<string, { serviceName: string; amount: number; quantity: number; createdAt: string }> = {}
    services.forEach((item) => {
      if (item.type === "service") {
        const key = `${item.serviceName}-${item.amount}`
        if (grouped[key]) {
          grouped[key].quantity += 1
        } else {
          grouped[key] = {
            serviceName: item.serviceName,
            amount: item.amount,
            quantity: 1,
            createdAt: item.createdAt || new Date().toLocaleString(),
          }
        }
      }
    })
    return Object.values(grouped)
  }

  const serviceItems = selectedRecord?.services.filter((s) => s.type === "service") || []
  const groupedServiceItems = getGroupedServices(serviceItems)
  const hospitalServiceTotal = serviceItems.reduce((sum, s) => sum + s.amount, 0)

  const consultantChargeItems = selectedRecord?.services.filter((s) => s.type === "doctorvisit") || []
  const consultantChargeTotal = consultantChargeItems.reduce((sum, s) => sum + s.amount, 0)

  const discountVal = selectedRecord?.discount || 0
  const totalBill = hospitalServiceTotal + consultantChargeTotal - discountVal
  const totalRefunds = selectedRecord
    ? selectedRecord.payments.filter((p) => p.amountType === "refund").reduce((sum, p) => sum + p.amount, 0)
    : 0
  const balanceAmount = totalBill - (selectedRecord?.totalDeposit || 0)
  const discountPercentage =
    hospitalServiceTotal + consultantChargeTotal > 0
      ? ((discountVal / (hospitalServiceTotal + consultantChargeTotal)) * 100).toFixed(1)
      : "0.0"

  // Aggregate consultant charges
  const aggregatedConsultantCharges = consultantChargeItems.reduce(
    (acc, item) => {
      const key = item.doctorName || "Unknown"
      if (!acc[key]) {
        acc[key] = {
          doctorName: key,
          visited: 0,
          totalCharge: 0,
          lastVisit: null,
          items: [],
        };
      }
      acc[key].visited += 1;
      acc[key].totalCharge += item.amount;
      const itemDate = item.createdAt ? new Date(item.createdAt) : new Date(0);
      
      // Fix: Use a temporary variable to help TypeScript with type narrowing
      const currentLastVisit = acc[key].lastVisit;
      if (currentLastVisit === null || itemDate > currentLastVisit) {
        acc[key].lastVisit = itemDate;
      }
      acc[key].items.push(item);
      return acc
    },
    {} as Record<
      string,
      {
        doctorName: string
        visited: number
        totalCharge: number
        lastVisit: Date | null
        items: ServiceDetailItemSupabase[]
      }
    >,
  )
  const aggregatedConsultantChargesArray = Object.values(aggregatedConsultantCharges)

  // Payment notification
  const sendPaymentNotification = async (
    patientMobile: string,
    patientName: string,
    paymentAmount: number,
    updatedDeposit: number,
    amountType: "advance" | "refund" | "deposit" | "settlement", // Corrected type for notification
  ) => {
    const apiUrl = "https://a.infispark.in/send-text"
    let message = ""
    if (amountType === "advance" || amountType === "deposit" || amountType === "settlement") {
      message = `Dear ${patientName}, your payment of Rs ${paymentAmount.toLocaleString()} has been successfully added to your account. Your updated total deposit is Rs ${updatedDeposit.toLocaleString()}. Thank you for choosing our service.`
    } else if (amountType === "refund") {
      message = `Dear ${patientName}, a refund of Rs ${paymentAmount.toLocaleString()} has been processed to your account. Your updated total deposit is Rs ${updatedDeposit.toLocaleString()}.`
    }
    const payload = { token: "9958399157", number: `91${patientMobile}`, message }
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) console.error("Notification API error:", response.statusText)
    } catch (error) {
      console.error("Error sending notification:", error)
    }
    console.log(`[MOCK] Sending WhatsApp notification for ${patientName}: Amount ${paymentAmount}, Type ${amountType}`)
  }

  // --- Handlers ---
  const onSubmitAdditionalService: SubmitHandler<AdditionalServiceForm> = async (data) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const newItems: ServiceDetailItemSupabase[] = []
      for (let i = 0; i < data.quantity; i++) {
        newItems.push({
          id: crypto.randomUUID(),
          serviceName: data.serviceName,
          doctorName: "", // Not applicable for hospital services
          type: "service", // Default type for additional services
          amount: Number(data.amount),
          createdAt: new Date().toISOString(),
        })
      }

      const updatedServices = [...(selectedRecord.services || []), ...newItems]

      const { error } = await supabase
        .from("ipd_registration")
        .update({ service_detail: updatedServices })
        .eq("ipd_id", ipdId)

      if (error) throw error

      toast.success(`Additional service${data.quantity > 1 ? "s" : ""} added successfully!`)
      setSelectedRecord((prev) => (prev ? { ...prev, services: updatedServices } : null))
      resetService({ serviceName: "", amount: 0, quantity: 1 })
    } catch (error) {
      console.error("Error adding service:", error)
      toast.error("Failed to add service. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleAddBulkServices = async (servicesToAdd: ParsedServiceItem[]) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const newItems: ServiceDetailItemSupabase[] = []
      for (const svc of servicesToAdd) {
        for (let i = 0; i < svc.quantity; i++) {
          newItems.push({
            id: crypto.randomUUID(),
            serviceName: svc.serviceName,
            doctorName: svc.doctorName || "", // Ensure doctorName is not undefined
            type: svc.type, // Use the type from ParsedServiceItem
            amount: Number(svc.amount),
            createdAt: new Date().toISOString(),
          })
        }
      }

      const updatedServices = [...(selectedRecord.services || []), ...newItems]

      const { error } = await supabase
        .from("ipd_registration")
        .update({ service_detail: updatedServices })
        .eq("ipd_id", ipdId)

      if (error) throw error

      toast.success(`Bulk services added successfully!`)
      setSelectedRecord((prev) => (prev ? { ...prev, services: updatedServices } : null))
    } catch (error) {
      console.error("Error adding bulk services:", error)
      toast.error("Failed to add bulk services. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const onSubmitPayment: SubmitHandler<PaymentForm> = async (formData) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const now = new Date()
      const [year, month, day] = formData.paymentDate.split("-").map(Number)
      const combined = new Date(
        year,
        month - 1,
        day,
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds(),
      )
      const isoDate = combined.toISOString()

      const newPayment: PaymentDetailItemSupabase = {
        id: crypto.randomUUID(),
        amount: Number(formData.paymentAmount),
        paymentType: formData.paymentType,
        transactionType: formData.transactionType, // Use the selected transaction type
        amountType: formData.transactionType, // Set amountType based on transactionType
        date: isoDate,
        createdAt: isoDate,
        through: formData.through, // Save 'through' field
        remark: formData.remark || "", // Always save as string
      }

      const updatedPayments = [...(selectedRecord.payments || []), newPayment]

      let updatedTotalDeposit = 0
      let updatedTotalDiscount = 0
      updatedPayments.forEach((p) => {
        if (p.amountType === "advance" || p.amountType === "deposit" || p.amountType === "settlement") {
          updatedTotalDeposit += p.amount
        } else if (p.amountType === "refund") {
          updatedTotalDeposit -= p.amount
        } else if (p.amountType === "discount") {
          updatedTotalDiscount += p.amount
        }
      })

      const { error } = await supabase
        .from("ipd_registration")
        .update({ payment_detail: updatedPayments })
        .eq("ipd_id", ipdId)

      if (error) throw error

      if (formData.sendWhatsappNotification) {
        await sendPaymentNotification(
          selectedRecord.mobileNumber,
          selectedRecord.name,
          newPayment.amount,
          updatedTotalDeposit,
          newPayment.amountType as "advance" | "refund" | "deposit" | "settlement", // Cast for notification type
        )
      }

      toast.success("Payment recorded successfully!")
      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              payments: updatedPayments,
              totalDeposit: updatedTotalDeposit,
              discount: updatedTotalDiscount,
            }
          : null,
      )
      resetPayment({
        paymentAmount: 0,
        paymentType: "cash",
        transactionType: "advance", // Reset to 'advance'
        sendWhatsappNotification: false,
        paymentDate: format(new Date(), "yyyy-MM-dd"),
        through: "cash", // Reset to 'cash' after submission
        remark: "",
      })
    } catch (error) {
      console.error("Error recording payment:", error)
      toast.error("Failed to record payment. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleDischarge = () => {
    if (!selectedRecord) return
    router.push(`/ipd/discharge/${selectedRecord.ipdId}`)
  }

  const onSubmitDiscount: SubmitHandler<DiscountForm> = async (formData) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const discountValue = Number(formData.discountAmount)

      const paymentsWithoutPreviousDiscounts = selectedRecord.payments.filter((p) => p.amountType !== "discount")

      const now = new Date()
      const isoDate = now.toISOString()

      const newDiscountEntry: PaymentDetailItemSupabase = {
        id: crypto.randomUUID(),
        amount: discountValue,
        paymentType: "bill_reduction", // This can be a fixed string for discounts
        transactionType: "discount",
        amountType: "discount", // Explicitly set amountType for discount
        date: isoDate,
        createdAt: isoDate,
        discountGivenBy: formData.discountGivenBy === "Other" ? formData.otherDiscountGivenBy : formData.discountGivenBy, // Save who gave the discount
      }

      const updatedPayments = [...paymentsWithoutPreviousDiscounts, newDiscountEntry]

      let updatedTotalDeposit = 0
      let updatedTotalDiscount = 0
      updatedPayments.forEach((p) => {
        if (p.amountType === "advance" || p.amountType === "deposit" || p.amountType === "settlement") {
          updatedTotalDeposit += p.amount
        } else if (p.amountType === "refund") {
          updatedTotalDeposit -= p.amount
        } else if (p.amountType === "discount") {
          updatedTotalDiscount += p.amount
        }
      })

      const { error } = await supabase
        .from("ipd_registration")
        .update({ payment_detail: updatedPayments })
        .eq("ipd_id", ipdId)

      if (error) {
        console.error("Supabase error applying discount:", error.message, error.details);
        throw error;
      }

      toast.success("Discount applied successfully!")
      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              payments: updatedPayments,
              totalDeposit: updatedTotalDeposit,
              discount: updatedTotalDiscount,
              discountGivenBy: formData.discountGivenBy === "Other" ? formData.otherDiscountGivenBy : formData.discountGivenBy,
            }
          : null,
      )
      setDiscountUpdated(true)
      setTimeout(() => setIsDiscountModalOpen(false), 1000)
      if (formData.discountGivenBy === "Other") {
        resetDiscount({ discountGivenBy: "Self", otherDiscountGivenBy: null }); // Clear custom name after saving
      } else {
        resetDiscount({ discountGivenBy: "Self", otherDiscountGivenBy: null });
      }
    } catch (error) {
      console.error("Error applying discount:", error)
      toast.error("Failed to apply discount. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const onSubmitDoctorVisit: SubmitHandler<DoctorVisitForm> = async (data) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const doctorName = data.isCustomDoctor
        ? data.customDoctorName || "Custom Doctor"
        : doctors.find((d) => d.id === data.doctorId)?.name || "Unknown"

      const newItems: ServiceDetailItemSupabase[] = []
      for (let i = 0; i < data.visitTimes; i++) {
        newItems.push({
          id: crypto.randomUUID(),
          serviceName: `Consultant Charge: Dr. ${doctorName}`,
          doctorName,
          type: "doctorvisit",
          amount: Number(data.visitCharge),
          createdAt: new Date().toISOString(),
        })
      }

      const updatedServices = [...(selectedRecord.services || []), ...newItems]

      const { error } = await supabase
        .from("ipd_registration")
        .update({ service_detail: updatedServices })
        .eq("ipd_id", ipdId)

      if (error) throw error

      toast.success(
        `Consultant charge${data.visitTimes > 1 ? "s" : ""} added successfully! (${data.visitTimes} visit${data.visitTimes > 1 ? "s" : ""})`,
      )
      setSelectedRecord((prev) => (prev ? { ...prev, services: updatedServices } : null))
      resetVisit({ doctorId: null, visitCharge: 0, visitTimes: 1, customDoctorName: "", isCustomDoctor: false })
    } catch (error) {
      console.error("Error adding consultant charge:", error)
      toast.error("Failed to add consultant charge. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteGroupedServiceItem = async (serviceName: string, amount: number) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const updatedServices = selectedRecord.services.filter(
        (svc) => !(svc.serviceName === serviceName && svc.amount === amount && svc.type === "service"),
      )

      const { error } = await supabase
        .from("ipd_registration")
        .update({ service_detail: updatedServices })
        .eq("ipd_id", ipdId)

      if (error) throw error

      toast.success(`All instances of '${serviceName}' deleted successfully!`)
      setSelectedRecord((prev) => (prev ? { ...prev, services: updatedServices } : null))
    } catch (error) {
      console.error("Error deleting service:", error)
      toast.error("Failed to delete service. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePayment = async (
    paymentId: string,
    paymentAmount: number,
    amountType: "advance" | "refund" | "deposit" | "discount" | "settlement", // Corrected type
  ) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const updatedPayments = selectedRecord.payments.filter((p) => p.id !== paymentId)

      let updatedTotalDeposit = 0
      let updatedTotalDiscount = 0
      updatedPayments.forEach((p) => {
        if (p.amountType === "advance" || p.amountType === "deposit" || p.amountType === "settlement") {
          updatedTotalDeposit += p.amount
        } else if (p.amountType === "refund") {
          updatedTotalDeposit -= p.amount
        } else if (p.amountType === "discount") {
          updatedTotalDiscount += p.amount
        }
      })

      const { error } = await supabase
        .from("ipd_registration")
        .update({ payment_detail: updatedPayments })
        .eq("ipd_id", ipdId)

      if (error) throw error

      toast.success("Payment deleted successfully!")
      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              payments: updatedPayments,
              totalDeposit: updatedTotalDeposit,
              discount: updatedTotalDiscount,
            }
          : null,
      )
    } catch (error) {
      console.error("Error deleting payment:", error)
      toast.error("Failed to delete payment. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteConsultantCharges = async (doctorName: string) => {
    if (!selectedRecord) return
    setLoading(true)
    try {
      const updatedServices = selectedRecord.services.filter(
        (svc) => svc.type !== "doctorvisit" || svc.doctorName !== doctorName,
      )

      const { error } = await supabase
        .from("ipd_registration")
        .update({ service_detail: updatedServices })
        .eq("ipd_id", ipdId)

      if (error) throw error

      toast.success(`Consultant charges for Dr. ${doctorName} deleted successfully!`)
      setSelectedRecord((prev) => (prev ? { ...prev, services: updatedServices } : null))
    } catch (error) {
      console.error("Error deleting consultant charges:", error)
      toast.error("Failed to delete consultant charges. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const doctorOptions = doctors.map((doc) => ({ value: String(doc.id), label: `${doc.name} (${doc.specialist})` }))

  // FIX: Directly use selectedRecord.doctor as it's already the doctor's name (text) from the DB.
  let primaryDoctorName = selectedRecord?.doctor || "N/A"

  const handleCopyDetails = async () => {
    if (!selectedRecord) {
      toast.error("No patient record selected to copy details.")
      return
    }
    try {
      const admissionDate = selectedRecord.admitDate ? format(parseISO(selectedRecord.admitDate), "dd-MM-yyyy") : "N/A"
      const dischargeDate = selectedRecord.dischargeDate
        ? format(parseISO(selectedRecord.dischargeDate), "dd-MM-yyyy")
        : ""
      const uhid = selectedRecord.uhid || "N/A"
      const blankColumn = ""
      const patientName = selectedRecord.name || "N/A"
      const age = selectedRecord.age || "N/A"
      const genderInitial = selectedRecord.gender?.charAt(0).toUpperCase() || "N/A"
      const ageGender = `${age}/${genderInitial}`
      const contactNumber = selectedRecord.mobileNumber || "N/A"
      let roomName = "N/A"
      if (selectedRecord.roomType) {
        roomName = selectedRecord.roomType
        if (selectedRecord.bedNumber) {
          roomName += ` (Bed: ${selectedRecord.bedNumber})`
        }
      }
      const doctorName = primaryDoctorName

      const detailsToCopy = [
        admissionDate,
        dischargeDate,
        uhid,
        blankColumn,
        patientName,
        ageGender,
        contactNumber,
        roomName,
        doctorName,
      ].join("\t") // Tab-separated for Excel

      await navigator.clipboard.writeText(detailsToCopy)
      toast.success("Patient details copied to clipboard!")
    } catch (error) {
      console.error("Failed to copy details:", error)
      toast.error("Failed to copy details. Please try again.")
    }
  }

  const getThroughOptions = () => {
    if (watchPaymentType === "online" || watchPaymentType === "card") {
      return (
        <>
          <option value="">Select Option</option>
          <option value="upi">UPI</option>
          <option value="credit-card">Credit Card</option>
          <option value="debit-card">Debit Card</option>
          <option value="netbanking">Net Banking</option>
          <option value="cheque">Cheque</option>
        </>
      );
    }
    return <option value="cash">Cash</option>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-teal-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 animate-spin mx-auto mb-4 text-teal-600" />
          <p className="text-xl text-gray-600">Loading patient billing data...</p>
        </div>
      </div>
    )
  }

  if (!selectedRecord) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-teal-50 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-xl text-gray-600">Patient record not found or an error occurred.</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-teal-50">
      {/* HEADER */}
      <header className="bg-white border-b border-teal-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
          <button
  onClick={() => router.push("/ipd/management")}
  className="flex items-center text-teal-600 hover:text-teal-800 transition-colors font-medium"
>
  <ArrowLeft size={18} className="mr-2" /> Back to Patients
</button>

            <div className="flex items-center space-x-4">
              {/* Discharge Summary button is now always visible if a record is selected */}
              {selectedRecord && (
                <button
                  onClick={handleDischarge}
                  disabled={loading}
                  className="flex items-center px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors shadow-sm"
                >
                  <FileText size={16} className="mr-2" /> Discharge Summary
                </button>
              )}
              <button
                onClick={handleCopyDetails}
                disabled={loading || !selectedRecord}
                className="flex items-center px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors shadow-sm"
              >
                <Clipboard size={16} className="mr-2" /> Copy Details
              </button>
              <button
                onClick={() => setIsPaymentHistoryOpen(true)}
                className="flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                <History size={16} className="mr-2" /> Payment History
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key="billing-details"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {/* PATIENT SUMMARY CARD */}
            <div className="bg-white rounded-2xl shadow-md overflow-hidden mb-8">
              <div className="bg-gradient-to-r from-teal-500 to-cyan-500 px-6 py-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-white">{selectedRecord.name}</h1>
                    <p className="text-teal-50">UHID: {selectedRecord.uhid || "Not assigned"}</p>
                    <p className="text-teal-50 mt-1">
                      Under care of Dr.: <span className="font-semibold">{primaryDoctorName}</span>
                    </p>
                  </div>
                  <div className="mt-2 md:mt-0 flex flex-col md:items-end">
                    <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 text-white text-sm">
                      <Bed size={14} className="mr-2" />
                      {selectedRecord.roomType || "No Room"} • {selectedRecord.bedNumber || "Unknown Bed"}
                    </div>
                    <div className="mt-2 text-teal-50 text-sm">
                      {selectedRecord.dischargeDate ? (
                        <span className="inline-flex items-center">
                          <AlertTriangle size={14} className="mr-1" /> Discharged:{" "}
                          {format(parseISO(selectedRecord.dischargeDate), "dd MMM,yyyy")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center">
                          <Calendar size={14} className="mr-1" /> Admitted:{" "}
                          {selectedRecord.admitDate
                            ? format(parseISO(selectedRecord.admitDate), "dd MMM,yyyy")
                            : "Unknown"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Financial Summary */}
                  <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-xl p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-teal-800 mb-3">Financial Summary</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Hospital Services:</span>
                        <span className="font-medium">₹{hospitalServiceTotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Consultant Charges:</span>
                        <span className="font-medium">₹{consultantChargeTotal.toLocaleString()}</span>
                      </div>
                      {discountVal > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span className="flex items-center">
                            <Tag size={14} className="mr-1" /> Discount ({discountPercentage}%):
                          </span>
                          <span className="font-medium">-₹{discountVal.toLocaleString()}</span>
                        </div>
                      )}
                      {discountVal > 0 && selectedRecord.discountGivenBy && (
                        <div className="flex justify-between text-gray-600 text-sm italic mt-1">
                          <span>(Discount given by: {selectedRecord.discountGivenBy})</span>
                        </div>
                      )}
                      <div className="border-t border-teal-200 pt-2 mt-2">
                        <div className="flex justify-between font-bold text-teal-800">
                          <span>Total Bill:</span>
                          <span>₹{totalBill.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-600">Total Payments Received:</span>
                        <span className="font-medium">₹{selectedRecord.totalDeposit.toLocaleString()}</span>
                      </div>
                      {totalRefunds > 0 && (
                        <div className="flex justify-between text-blue-600">
                          <span className="text-gray-600">Total Refunds:</span>
                          <span className="font-medium">₹{totalRefunds.toLocaleString()}</span>
                        </div>
                      )}
                      {balanceAmount > 0 ? (
                        <div className="flex justify-between text-red-600 font-bold">
                          <span>Due Amount:</span>
                          <span>₹{balanceAmount.toLocaleString()}</span>
                        </div>
                      ) : balanceAmount < 0 ? (
                        <div className="flex justify-between text-blue-600 font-bold">
                          <span>We have to refund :</span>
                          <span>₹{Math.abs(balanceAmount).toLocaleString()}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-green-600 font-bold">
                          <span>Balance:</span>
                          <span>✓ Fully Paid</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setIsDiscountModalOpen(true)}
                      className="mt-4 w-full flex items-center justify-center px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg transition-colors shadow-sm"
                    >
                      <Percent size={16} className="mr-2" />
                      {discountVal > 0 ? "Update Discount" : "Add Discount"}
                    </button>
                  </div>

                  {/* Patient Details */}
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                      <User size={18} className="mr-2 text-teal-600" /> Patient Details
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-start">
                        <Phone size={16} className="mr-2 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-sm text-gray-500">Mobile</p>
                          <p className="font-medium">{selectedRecord.mobileNumber}</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <MapPin size={16} className="mr-2 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-sm text-gray-500">Address</p>
                          <p className="font-medium">{selectedRecord.address || "Not provided"}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-sm text-gray-500">Age</p>
                          <p className="font-medium">
                            {selectedRecord.age || "N/A"} {selectedRecord.ageUnit || "years"}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Gender</p>
                          <p className="font-medium">{selectedRecord.gender || "Not provided"}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Relative Details */}
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                      <Users size={18} className="mr-2 text-teal-600" /> Relative Details
                    </h3>
                    <div className="space-y-2">
                      <div>
                        <p className="text-sm text-gray-500">Name</p>
                        <p className="font-medium">{selectedRecord.relativeName || "Not provided"}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Phone</p>
                        <p className="font-medium">{selectedRecord.relativePhone || "Not provided"}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Address</p>
                        <p className="font-medium">{selectedRecord.relativeAddress || "Not provided"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">Quick Actions</h3>
                    <div className="space-y-3">
                      {/* Preview Bill */}
                      <InvoiceDownload
                        record={{
                          ...selectedRecord,
                          payments: (selectedRecord.payments ?? []).filter(
                            (p): p is Exclude<typeof p, undefined> => p !== undefined
                          ) as any // Cast to any to satisfy InvoiceDownload's prop type
                        }}
                        beds={beds}
                        doctors={doctors}
                      >
                        <button
                          type="button"
                          className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        >
                          <FileText size={16} className="mr-2" /> Preview Bill
                        </button>
                      </InvoiceDownload>
                      <button
                        onClick={() => setActiveTab("payments")}
                        className="w-full flex items-center justify-center px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
                      >
                        <CreditCard size={16} className="mr-2" /> Add Payment
                      </button>
                      <button
                        onClick={() => setIsBulkServiceModalOpen(true)}
                        className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                      >
                        <Plus size={16} className="mr-2" /> Add Bulk Service
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* TABS */}
            <div className="mb-6">
              <div className="border-b border-gray-200">
                <nav className="flex -mb-px space-x-8">
                  <button
                    onClick={() => setActiveTab("overview")}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                      activeTab === "overview"
                        ? "border-teal-500 text-teal-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <FileText size={16} className="mr-2" /> Overview
                  </button>
                  <button
                    onClick={() => setActiveTab("services")}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                      activeTab === "services"
                        ? "border-teal-500 text-teal-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <Plus size={16} className="mr-2" /> Services
                  </button>
                  <button
                    onClick={() => setActiveTab("payments")}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                      activeTab === "payments"
                        ? "border-teal-500 text-teal-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <CreditCard size={16} className="mr-2" /> Payments
                  </button>
                  <button
                    onClick={() => setActiveTab("consultants")}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                      activeTab === "consultants"
                        ? "border-teal-500 text-teal-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <UserPlus size={16} className="mr-2" /> Consultants
                  </button>
                  <button
                    onClick={() => setActiveTab("note")}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                      activeTab === "note"
                        ? "border-teal-500 text-teal-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <FileText size={16} className="mr-2" /> Note
                  </button>
                </nav>
              </div>
            </div>

            {/* TAB CONTENT */}
            <div className="bg-white rounded-2xl shadow-md overflow-hidden">
              {/* Overview Tab */}
              {activeTab === "overview" && (
                <div className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Hospital Services Summary */}
                    <div>
                      <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                        <FileText size={20} className="mr-2 text-teal-600" /> Hospital Services
                      </h3>
                      {groupedServiceItems.length === 0 ? (
                        <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
                          No hospital services recorded yet.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Service
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Qty
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Amount
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Date
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {groupedServiceItems.slice(0, 5).map((srv, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm text-gray-900">{srv.serviceName}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-center">{srv.quantity}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                    ₹{srv.amount.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {srv.createdAt ? new Date(srv.createdAt).toLocaleDateString() : "N/A"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium">Total</td>
                                <td></td>
                                <td className="px-4 py-3 text-sm font-bold text-right">
                                  ₹{hospitalServiceTotal.toLocaleString()}
                                </td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                          {groupedServiceItems.length > 5 && (
                            <div className="mt-3 text-right">
                              <button
                                onClick={() => setActiveTab("services")}
                                className="text-teal-600 hover:text-teal-800 text-sm font-medium flex items-center justify-end w-full"
                              >
                                View all {groupedServiceItems.length} services{" "}
                                <ChevronRight size={16} className="ml-1" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Consultant Charges Summary */}
                    <div>
                      <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                        <UserPlus size={20} className="mr-2 text-teal-600" /> Consultant Charges
                      </h3>
                      {consultantChargeItems.length === 0 ? (
                        <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
                          No consultant charges recorded yet.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Doctor
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Visits
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Total
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Date
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {aggregatedConsultantChargesArray.map((agg, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm text-gray-900">{agg.doctorName}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-center">{agg.visited}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                    ₹{agg.totalCharge.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {agg.lastVisit ? agg.lastVisit.toLocaleString() : "N/A"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium">Total</td>
                                <td></td>
                                <td className="px-4 py-3 text-sm font-bold text-right">
                                  ₹{consultantChargeTotal.toLocaleString()}
                                </td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                          <div className="mt-3 text-right">
                            <button
                              onClick={() => setActiveTab("consultants")}
                              className="text-teal-600 hover:text-teal-800 text-sm font-medium flex items-center justify-end w-full"
                            >
                              View consultant details <ChevronRight size={16} className="ml-1" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Services Tab */}
              {activeTab === "services" && (
                <ServiceTab
                  selectedRecord={selectedRecord}
                  loading={loading}
                  groupedServiceItems={groupedServiceItems}
                  hospitalServiceTotal={hospitalServiceTotal}
                  errorsService={errorsService}
                  registerService={registerService}
                  handleSubmitService={handleSubmitService}
                  onSubmitAdditionalService={onSubmitAdditionalService}
                  serviceControl={serviceControl}
                  masterServiceOptions={masterServiceOptions}
                  setValueService={setValueService}
                  resetService={resetService}
                  handleDeleteGroupedServiceItem={handleDeleteGroupedServiceItem}
                  discountVal={discountVal}
                  discountPercentage={discountPercentage}
                  setIsDiscountModalOpen={setIsDiscountModalOpen}
                />
              )}

              {/* Payments Tab */}
              {activeTab === "payments" && (
                <PaymentTab
                  selectedRecord={selectedRecord}
                  loading={loading}
                  errorsPayment={errorsPayment}
                  registerPayment={registerPayment}
                  handleSubmitPayment={handleSubmitPayment}
                  onSubmitPayment={onSubmitPayment}
                  watchPaymentType={watchPaymentType}
                  getThroughOptions={getThroughOptions}
                  handleDeletePayment={
                    handleDeletePayment as (id: string, amount: number, amountType: string) => void
                  }
                />
              )}
              {activeTab === "consultants" && (
                <div className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2">
                      <h3 className="text-xl font-semibold text-gray-800 mb-4">Consultant Charges</h3>
                      {consultantChargeItems.length === 0 ? (
                        <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
                          No consultant charges recorded yet.
                        </div>
                      ) : (
                        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
                          <table className="w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Doctor
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Visits
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Total Charge (₹)
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Last Visit
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Action
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {aggregatedConsultantChargesArray.map((agg, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm text-gray-900">{agg.doctorName}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-center">{agg.visited}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                    ₹{agg.totalCharge.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {agg.lastVisit ? agg.lastVisit.toLocaleString() : "N/A"}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-center">
                                    <button
                                      onClick={() => handleDeleteConsultantCharges(agg.doctorName)}
                                      className="text-red-500 hover:text-red-700 transition-colors"
                                      title="Delete consultant charges"
                                    >
                                      <Trash size={16} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium">Total</td>
                                <td></td>
                                <td className="px-4 py-3 text-sm font-bold text-right">
                                  ₹{consultantChargeTotal.toLocaleString()}
                                </td>
                                <td colSpan={2}></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="lg:col-span-1">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                          <UserPlus size={16} className="mr-2 text-teal-600" /> Add Consultant Charge
                        </h3>
                        <form onSubmit={handleSubmitVisit(onSubmitDoctorVisit)} className="space-y-4">
                          <div className="flex items-center space-x-2 mb-4">
                            <input
                              type="checkbox"
                              {...registerVisit("isCustomDoctor")}
                              id="customDoctorToggle"
                              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                            />
                            <label htmlFor="customDoctorToggle" className="text-sm font-medium text-gray-700">
                              Add custom doctor
                            </label>
                          </div>
                          {!watchIsCustomDoctor ? (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Search size={16} className="inline mr-1" />
                                Select Doctor
                              </label>
                              <Controller
                                control={visitControl}
                                name="doctorId"
                                render={({ field }) => (
                                  <Select
                                    {...field}
                                    isClearable
                                    options={doctorOptions}
                                    placeholder="Search or select a doctor..."
                                    onChange={(opt) => field.onChange(opt ? Number(opt.value) : null)}
                                    value={doctorOptions.find((o) => Number(o.value) === field.value) || null}
                                    classNamePrefix="react-select"
                                    styles={{
                                      control: (base, state) => ({
                                        ...base,
                                        borderColor: errorsVisit.doctorId ? "rgb(239 68 68)" : base.borderColor,
                                        boxShadow: state.isFocused ? "0 0 0 2px rgb(20 184 166)" : base.boxShadow,
                                        "&:hover": {
                                          borderColor: errorsVisit.doctorId
                                            ? "rgb(239 68 68)"
                                            : (base["&:hover"] as any)?.borderColor || "transparent",
                                        },
                                      }),
                                    }}
                                  />
                                )}
                              />
                              {errorsVisit.doctorId && (
                                <p className="text-red-500 text-xs mt-1">{errorsVisit.doctorId.message}</p>
                              )}
                            </div>
                          ) : (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Custom Doctor Name</label>
                              <input
                                type="text"
                                {...registerVisit("customDoctorName")}
                                placeholder="Enter doctor name"
                                className={`w-full px-3 py-2 rounded-lg border ${
                                  errorsVisit.customDoctorName ? "border-red-500" : "border-gray-300"
                                } focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent`}
                              />
                              {errorsVisit.customDoctorName && (
                                <p className="text-red-500 text-xs mt-1">{errorsVisit.customDoctorName.message}</p>
                              )}
                            </div>
                          )}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Visit Charge (₹)</label>
                            <input
                              type="number"
                              {...registerVisit("visitCharge")}
                              placeholder={watchIsCustomDoctor ? "Enter charge amount" : "Auto-filled or override"}
                              className={`w-full px-3 py-2 rounded-lg border ${
                                errorsVisit.visitCharge ? "border-red-500" : "border-gray-300"
                              } focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent`}
                            />
                            {errorsVisit.visitCharge && (
                              <p className="text-red-500 text-xs mt-1">{errorsVisit.visitCharge.message}</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              <Clock size={16} className="inline mr-1" />
                              Number of Visits
                            </label>
                            <input
                              type="number"
                              {...registerVisit("visitTimes")}
                              min="1"
                              max="10"
                              placeholder="e.g., 2 for 2 visits"
                              className={`w-full px-3 py-2 rounded-lg border ${
                                errorsVisit.visitTimes ? "border-red-500" : "border-gray-300"
                              } focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent`}
                            />
                            {errorsVisit.visitTimes && (
                              <p className="text-red-500 text-xs mt-1">{errorsVisit.visitTimes.message}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                              Each visit will be recorded separately with current timestamp
                            </p>
                          </div>
                          <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-2 px-4 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center justify-center ${
                              loading ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                          >
                            {loading ? (
                              "Processing..."
                            ) : (
                              <>
                                <Plus size={16} className="mr-2" /> Add Consultant Charge
                              </>
                            )}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Note Tab */}
              {activeTab === "note" && (
                <Notetab
                  ipdNote={ipdNote}
                  setIpdNote={setIpdNote}
                  ipdNoteLoading={ipdNoteLoading}
                  onSaveNote={async (note) => {
                    setIpdNoteLoading(true);
                    try {
                      const { error } = await supabase
                        .from("ipd_registration")
                        .update({ ipd_notes: note })
                        .eq("ipd_id", Number(ipdId));
                      if (error) {
                        console.error("Supabase error updating note:", error);
                        toast.error("Failed to save note: " + error.message);
                      } else {
                        toast.success("Note saved successfully!");
                        setIpdNote(note); // Only update after successful save
                        await fetchBillingData(); // Refetch to update UI
                      }
                    } catch (e) {
                      toast.error("Failed to save note");
                    } finally {
                      setIpdNoteLoading(false);
                    }
                  }}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Payment History Modal */}
      <Transition appear show={isPaymentHistoryOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsPaymentHistoryOpen(false)}>
          <Transition.Child
            as={React.Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-40" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={React.Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-xl font-bold text-gray-800">Payment History</Dialog.Title>
                  <button
                    onClick={() => setIsPaymentHistoryOpen(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                {selectedRecord && selectedRecord.payments.length > 0 ? (
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            #
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Amount (₹)
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Payment Type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Through
                          </th>{/* New Table Header in Modal */}
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Date
                          </th>
                          {selectedRecord.payments.some(p => p.amountType === "discount" && p.discountGivenBy) && (
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Given By
                            </th>
                          )}
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {selectedRecord.payments.map((payment, idx) => (
                          <tr key={payment.id || idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{idx + 1}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">
                              {payment.amount.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 capitalize">{payment.paymentType}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 capitalize">{payment.amountType}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 capitalize">
                              {payment.through || "N/A"}
                            </td>{/* Display 'through' in Modal */}
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {new Date(payment.date).toLocaleString()}
                            </td>
                            {payment.amountType === "discount" && payment.discountGivenBy && (
                              <td className="px-4 py-3 text-sm text-gray-900">{payment.discountGivenBy}</td>
                            )}
                            <td className="px-4 py-3 text-sm text-center">
                              <button
                                onClick={() =>
                                  payment.id && payment.amountType &&
                                  handleDeletePayment(payment.id, payment.amount, payment.amountType)
                                }
                                className="text-red-500 hover:text-red-700 transition-colors"
                                title="Delete payment"
                              >
                                <Trash size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No payments recorded yet.</p>
                )}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setIsPaymentHistoryOpen(false)}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>

      {/* Discount Modal */}
      <Transition appear show={isDiscountModalOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsDiscountModalOpen(false)}>
          <Transition.Child
            as={React.Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-40" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={React.Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-xl font-bold text-gray-800 flex items-center">
                    <Percent size={20} className="mr-2 text-emerald-600" />
                    {discountVal > 0 ? "Update Discount" : "Add Discount"}
                  </Dialog.Title>
                  <button
                    onClick={() => setIsDiscountModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="mb-6">
                  <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg p-4 mb-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm text-gray-600">Total Bill Amount</p>
                        <p className="text-xl font-bold text-gray-800">
                          ₹{(hospitalServiceTotal + consultantChargeTotal).toLocaleString()}
                        </p>
                      </div>
                      {discountVal > 0 && (
                        <div className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-sm font-medium">
                          Current: ₹{discountVal.toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                  <form onSubmit={handleSubmitDiscount(onSubmitDiscount)} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Discount Amount (₹)</label>
                      <div className="relative">
                        <DollarSign className="absolute top-3 left-3 text-gray-400 h-5 w-5" />
                        <input
                          type="number"
                          {...registerDiscount("discountAmount")}
                          placeholder="Enter discount amount"
                          className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                            errorsDiscount.discountAmount ? "border-red-500" : "border-gray-300"
                          } transition duration-200`}
                        />
                      </div>
                      {errorsDiscount.discountAmount && (
                        <p className="text-red-500 text-xs mt-1">{errorsDiscount.discountAmount.message}</p>
                      )}
                    </div>

                    {/* New field for who gave the discount */}        
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Discount Given By</label>
                      <select
                        {...registerDiscount("discountGivenBy")}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                          errorsDiscount.discountGivenBy ? "border-red-500" : "border-gray-300"
                        } transition duration-200`}
                      >
                        <option value="">Select</option>
                        <option value="Self">Self</option>
                        <option value="Meraj Sir">Meraj Sir</option>
                        {/* <option value="Farid Sir">Farid Sir</option> */}
                        <option value="Other">Other</option>
                      </select>
                      {errorsDiscount.discountGivenBy && (
                        <p className="text-red-500 text-xs mt-1">{errorsDiscount.discountGivenBy.message}</p>
                      )}
                    </div>

                    {/* Conditional input for "Other" */}          
                    {watchDiscount("discountGivenBy") === "Other" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Other Person's Name</label>
                          <input
                            type="text"
                            {...registerDiscount("otherDiscountGivenBy")}
                            placeholder="Enter name"
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                              errorsDiscount.otherDiscountGivenBy ? "border-red-500" : "border-gray-300"
                            } transition duration-200`}
                          />
                          {errorsDiscount.otherDiscountGivenBy && watchDiscount("discountGivenBy") === "Other" && (
                            <p className="text-red-500 text-xs mt-1">{errorsDiscount.otherDiscountGivenBy.message}</p>
                          )}
                        </div>
                      </motion.div>
                    )}

                    {watchDiscount("discountAmount") > 0 && hospitalServiceTotal + consultantChargeTotal > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-emerald-50 p-3 rounded-lg border border-emerald-100"
                      >
                        <p className="text-sm text-emerald-700 flex items-center">
                          <Tag className="h-4 w-4 mr-1" />
                          This is equivalent to a{" "}
                          <span className="font-bold mx-1">
                            {(
                              (watchDiscount("discountAmount") / (hospitalServiceTotal + consultantChargeTotal)) *
                              100
                            ).toFixed(1)}
                            %
                          </span>{" "}
                          discount
                        </p>
                      </motion.div>
                    )}
                    <div className="flex space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsDiscountModalOpen(false)}
                        className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className={`flex-1 py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center ${
                          loading ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        {loading ? (
                          <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : discountUpdated ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : (
                          <Save className="h-5 w-5 mr-2" />
                        )}
                        {loading ? "Processing..." : discountUpdated ? "Saved!" : "Save Discount"}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>

      {/* Bulk Service Modal */}
      <BulkServiceModal
        isOpen={isBulkServiceModalOpen}
        onClose={() => setIsBulkServiceModalOpen(false)}
        onAddServices={handleAddBulkServices}
      />
    </div>
  )
}
