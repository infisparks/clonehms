"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useForm, Controller, FormProvider, useFieldArray } from "react-hook-form"
import { ToastContainer, toast } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"

// Ensure correct paths to your UI components
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Calendar,
  User,
  Phone,
  Stethoscope,
  CreditCard,
  FileText,
  Trash2,
  Search,
  Hospital,
  PhoneCall,
  MessageSquare,
  IndianRupeeIcon,
  PersonStandingIcon as PersonIcon,
  Clock,
  Cake,
  MapPin,
  CheckCircle,
  XCircle,
} from "lucide-react"
import "react-datepicker/dist/react-datepicker.css"

// Import the new custom input component for charges
import EditableChargesInput from "@/components/ui/input-new" // Adjust path as needed
// Import the new custom input component for service name
import EditableServiceNameInput from "@/components/ui/input-servicename" // New import
import { SearchableSelect } from "@/components/global/searchable-select"

// Ensure correct paths to your types
import {
  GenderOptions,
  ModalityOptions,
  PaymentOptions,
  AgeUnitOptions,
  OnlineThroughOptions,
  CashThroughOptions,
  type ModalitySelection,
  type PatientDetail,
  type OnCallAppointment,
  type Doctor,
  type IFormInput,
  XRayStudyOptions,
  PathologyStudyOptions,
  IPDServiceOptions,
  RadiologyServiceOptions,
  Casualty,
  CardiologyStudyOptions,
  type ServiceOption,
} from "@/app/opd/types" // IMPORTANT: Ensure your ModalitySelection, Doctor types are updated here.

// Ensure correct path to your action functions
import {
  createAppointment,
  searchPatientByUhId,
  searchPatientsByPhoneNumber,
  fetchDoctorsSupabase,
  fetchOnCallAppointmentsSupabase,
  deleteOnCallAppointment,
} from "@/action/appointment"
import { openBillInNewTabProgrammatically } from "./bill-generator"
import Layout from "@/components/global/Layout"
import { supabase } from "@/lib/supabase"

// Helper functions (kept at top-level scope)
function formatAMPM(date: Date): string {
  const h = date.getHours()
  const m = date.getMinutes()
  const ampm = h >= 12 ? "PM" : "AM"
  const hours = h % 12 || 12
  const mins = m < 10 ? `0${m}` : m.toString()
  return `${hours}:${mins} ${ampm}`
}

const getServiceOptions = (t: ModalitySelection["type"]): ServiceOption[] => {
  switch (t) {
    case "xray":
      return XRayStudyOptions
    case "pathology":
      return PathologyStudyOptions
    case "ipd":
      return IPDServiceOptions
    case "radiology":
      return RadiologyServiceOptions
    case "casualty":
      return Casualty
    case "cardiology":
      return CardiologyStudyOptions
    default:
      return []
  }
}

const AppointmentPage = () => {
  const [activeTab, setActiveTab] = useState("book")
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [onCallAppointments, setOnCallAppointments] = useState<OnCallAppointment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [lastUhid, setLastUhid] = useState<string | null>(null)
  const [lastBillNo, setLastBillNo] = useState<number | null>(null)
  const [searchUhIdInput, setSearchUhIdInput] = useState("")
  const [searchPhoneInput, setSearchPhoneInput] = useState("")
  const [searchedPatientResults, setSearchedPatientResults] = useState<PatientDetail[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<PatientDetail | null>(null)
  const [isEditingPatient, setIsEditingPatient] = useState(false)

  // State to track which charges input is currently being edited
  const [editingChargeIndex, setEditingChargeIndex] = useState<number | null>(null)
  // State to track which service name input is currently being edited
  const [editingServiceNameIndex, setEditingServiceNameIndex] = useState<number | null>(null)

  const nameInputRef = useRef<HTMLInputElement | null>(null) // Initialize with null
  const phoneInputRef = useRef<HTMLInputElement | null>(null) // Initialize with null

  const form = useForm<IFormInput>({
    defaultValues: {
      name: "",
      phone: "",
      age: undefined,
      ageUnit: "year",
      gender: "",
      address: "",
      appointmentType: "visithospital",
      referredBy: "",
      additionalNotes: "",
      paymentMethod: "cash",
      cashAmount: undefined,
      onlineAmount: undefined,
      discount: 0,
      onlineThrough: "upi",
      cashThrough: "cash",
      date: new Date(),
      time: formatAMPM(new Date()),
      modalities: [],
      opdType: "",
      doctor: "",
      specialist: "",
      visitType: "first",
      study: "",
      uhid: "",
    },
    mode: "onChange",
  })

  const {
    register,
    control,
    formState: { errors },
    watch,
    setValue,
    handleSubmit,
    reset,
    getValues, // Added getValues here
  } = form

  /* --------------------------------------------------------------------- */
  /* COMBINE RHF REF + LOCAL REF                                           */
  /* --------------------------------------------------------------------- */
  const nameField = register("name", { required: "Name is required" })
  const phoneField = register("phone", {
    required: "Phone number is required",
    pattern: { value: /^[0-9]{10}$/, message: "Enter a valid 10-digit number" },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "modalities" })
  const watchedModalities = watch("modalities") || [] // This is crucial for re-rendering when modalities change
  const watchedPaymentMethod = watch("paymentMethod")
  const watchedAppointmentType = watch("appointmentType")
  const watchedCashAmount = watch("cashAmount")
  const watchedOnlineAmount = watch("onlineAmount")
  const watchedDiscount = watch("discount")

  // Function to fetch and set doctors and on-call appointments
  const fetchInitialData = useCallback(async () => {
    setDoctors(await fetchDoctorsSupabase())
    try {
      const appointments = await fetchOnCallAppointmentsSupabase()
      setOnCallAppointments(appointments)
      // toast.success("On-call appointments loaded.");
    } catch (error: any) {
      console.error("Error fetching on-call appointments:", error)
      if (error && typeof error === "object" && error.message) {
        toast.error(`Failed to load on-call appointments: ${error.message}. Please check console.`)
      } else {
        toast.error("Failed to load on-call appointments. Please check console.")
      }
      setOnCallAppointments([])
    }
  }, [])

  useEffect(() => {
    fetchInitialData()
  }, [fetchInitialData])

  const fillFormWithPatientData = (p: PatientDetail) => {
    setValue("name", p.name || "", { shouldValidate: true })
    setValue("phone", p.number !== undefined && p.number !== null ? String(p.number) : "", { shouldValidate: true })
    setValue("age", p.age ? Number(p.age) : undefined, { shouldValidate: true })
    // Ensure ageUnit defaults to "year" if not provided or invalid
    const ageUnit = p.age_unit && ["year", "month", "day"].includes(p.age_unit) ? p.age_unit : "year"
    setValue("ageUnit", ageUnit, { shouldValidate: true })
    setValue("gender", p.gender || "", { shouldValidate: true })
    setValue("address", p.address || "")
    setValue("referredBy", "")
    setValue("additionalNotes", "")
    setValue("paymentMethod", "cash")
    setValue("cashAmount", undefined)
    setValue("onlineAmount", undefined)
    setValue("discount", 0)
    setValue("onlineThrough", "upi")
    setValue("cashThrough", "cash")
    setValue("uhid", p.uhid || "")
    setSelectedPatient(p)
    setValue("modalities", [])
    setActiveTab("book")
    setSearchUhIdInput("")
    setSearchPhoneInput("")
    setSearchedPatientResults(null)
    setIsEditingPatient(false) // Reset editing mode when loading new patient
    if (nameInputRef.current) nameInputRef.current.value = p.name || ""
    if (phoneInputRef.current) phoneInputRef.current.value = p.number ? String(p.number) : ""
  }

  const resetFormForNewPatient = useCallback(() => {
    reset({
      name: "",
      phone: "",
      age: undefined,
      ageUnit: "year",
      gender: "",
      address: "",
      appointmentType: "visithospital",
      referredBy: "",
      additionalNotes: "",
      paymentMethod: "cash",
      cashAmount: undefined,
      onlineAmount: undefined,
      discount: 0,
      onlineThrough: "upi",
      cashThrough: "cash",
      date: new Date(),
      time: formatAMPM(new Date()),
      modalities: [],
      opdType: "",
      doctor: "",
      specialist: "",
      visitType: "first",
      study: "",
      uhid: "",
    })
    setSelectedPatient(null)
    setSearchedPatientResults(null)
    setSearchUhIdInput("")
    setSearchPhoneInput("")
    setEditingChargeIndex(null) // Reset editing state on form reset
    setEditingServiceNameIndex(null) // Reset editing state for service name
    setIsEditingPatient(false) // Reset editing mode
  }, [reset])

  useEffect(() => {
    if (activeTab === "book" && !selectedPatient) resetFormForNewPatient()
    if (activeTab !== "oncall" && activeTab !== "book") {
      setSearchUhIdInput("")
      setSearchPhoneInput("")
      setSearchedPatientResults(null)
      setIsSearching(false)
    }
  }, [activeTab, selectedPatient, resetFormForNewPatient])



  // Total modality charges will update automatically because watchedModalities is a dependency
  const totalModalityCharges = useMemo(
    () => watchedModalities.reduce((t, m) => t + (Number(m.charges) || 0), 0),
    [watchedModalities], // This dependency means it re-calculates when 'modalities' array content changes
  )

  useEffect(() => {
    if (watchedAppointmentType === "visithospital" && !watchedPaymentMethod) setValue("paymentMethod", "cash")
  }, [watchedAppointmentType, watchedPaymentMethod, setValue])

  // This useEffect will handle automatic filling of payment amounts
  useEffect(() => {
    if (watchedAppointmentType === "visithospital" && watchedModalities.length > 0) {
      const total = totalModalityCharges
      // Only auto-fill if the amount is 0 or undefined, meaning the user hasn't started typing
      if (watchedPaymentMethod === "cash") {
        if (watchedCashAmount === undefined || watchedCashAmount === 0) {
          setValue("cashAmount", total, { shouldValidate: true })
        }
        setValue("onlineAmount", 0, { shouldValidate: true }) // Ensure online is zero if cash is chosen
      } else if (
        watchedPaymentMethod === "online" ||
        watchedPaymentMethod === "card-credit" ||
        watchedPaymentMethod === "card-debit"
      ) {
        if (watchedOnlineAmount === undefined || watchedOnlineAmount === 0) {
          setValue("onlineAmount", total, { shouldValidate: true })
        }
        setValue("cashAmount", 0, { shouldValidate: true }) // Ensure cash is zero if online/card is chosen
      } else if (watchedPaymentMethod === "mixed") {
        // For mixed, auto-fill if both are empty/zero
        if (
          (watchedCashAmount === undefined || watchedCashAmount === 0) &&
          (watchedOnlineAmount === undefined || watchedOnlineAmount === 0)
        ) {
          setValue("cashAmount", total, { shouldValidate: true })
          setValue("onlineAmount", 0, { shouldValidate: true })
        }
      }
      // Set discount to 0 initially if total charges are positive and discount is unset
      if (total > 0 && (watchedDiscount === undefined || watchedDiscount === 0)) {
        setValue("discount", 0, { shouldValidate: true })
      }
    } else if (watchedAppointmentType === "visithospital" && watchedModalities.length === 0) {
      // If no modalities, clear payment amounts and discount
      setValue("cashAmount", undefined)
      setValue("onlineAmount", undefined)
      setValue("discount", 0)
    }
  }, [
    watchedModalities.length,
    watchedAppointmentType,
    watchedPaymentMethod,
    totalModalityCharges,
    watchedCashAmount,
    watchedOnlineAmount,
    watchedDiscount,
    setValue,
  ])

  useEffect(() => {
    if (watchedAppointmentType !== "visithospital") return
    const totalPaid = (Number(watchedCashAmount) || 0) + (Number(watchedOnlineAmount) || 0)
    const discount = Math.max(0, totalModalityCharges - totalPaid)
    // Only update if the value has genuinely changed to prevent unnecessary renders
    if (watchedDiscount !== discount) {
      setValue("discount", discount, { shouldValidate: true })
    }
  }, [watchedAppointmentType, watchedCashAmount, watchedOnlineAmount, totalModalityCharges, setValue, watchedDiscount])

  const calculateTotalAmountPaid = () => (Number(watch("cashAmount")) || 0) + (Number(watch("onlineAmount")) || 0)

  const addModality = (type: ModalitySelection["type"]) =>
    append({ id: Math.random().toString(36).substr(2, 9), type, charges: 0, doctor: "", doctorId: "", service: "" }) // Added service: "" default

  const removeModality = (index: number) => {
    remove(index)
    // If the removed modality was being edited, reset the editing state
    if (editingChargeIndex === index) {
      setEditingChargeIndex(null)
    }
    if (editingServiceNameIndex === index) {
      // Reset service name editing state
      setEditingServiceNameIndex(null)
    }
    // Adjust editing index if a modality before the currently edited one is removed
    if (editingChargeIndex !== null && index < editingChargeIndex) {
      setEditingChargeIndex(editingChargeIndex - 1)
    }
    if (editingServiceNameIndex !== null && index < editingServiceNameIndex) {
      // Adjust service name editing state
      setEditingServiceNameIndex(editingServiceNameIndex - 1)
    }
  }

  // This function is for updating any modality field other than 'charges' directly via input
  const updateModalityField = (index: number, key: keyof ModalitySelection | "doctorId", value: any) => {
    const currentModalities = getValues("modalities")
    const newModalitiesArray = [...currentModalities]
    newModalitiesArray[index] = { ...newModalitiesArray[index], [key]: value }
    setValue("modalities", newModalitiesArray as ModalitySelection[], {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    })
  }

  // This specific handler will be passed to EditableChargesInput for saving charges
  const handleSaveCharges = (index: number, newValue: number) => {
    const currentModalities = getValues("modalities")
    const newModalitiesArray = [...currentModalities] // Create a new array reference
    newModalitiesArray[index] = { ...newModalitiesArray[index], charges: newValue } // Update the specific item
    setValue("modalities", newModalitiesArray as ModalitySelection[], {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    })
    setEditingChargeIndex(null) // Exit editing mode for this input
  }

  // New handler for saving custom service names
  const handleSaveServiceName = (index: number, newValue: string) => {
    const currentModalities = getValues("modalities")
    const newModalitiesArray = [...currentModalities]
    newModalitiesArray[index] = { ...newModalitiesArray[index], service: newValue }
    setValue("modalities", newModalitiesArray as ModalitySelection[], {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    })
    setEditingServiceNameIndex(null) // Exit editing mode
  }

  const handleSearchByUhId = async () => {
    if (!searchUhIdInput.trim()) return toast.error("Enter UHID to search.")
    setIsSearching(true)
    setSearchedPatientResults(null)
    resetFormForNewPatient()
    try {
      const res = await searchPatientByUhId(searchUhIdInput.trim().toUpperCase())
      if (res.success && res.patient) {
        fillFormWithPatientData(res.patient)
        toast.success("Patient loaded.")
      } else toast.error(res.message || "Patient not found.")
    } catch (e) {
      console.error(e)
      toast.error("UHID search failed.")
    } finally {
      setIsSearching(false)
    }
  }

  const handleSearchByPhoneNumber = async () => {
    if (!searchPhoneInput.trim()) return toast.error("Enter phone number to search.")
    setIsSearching(true)
    setSearchedPatientResults(null)
    resetFormForNewPatient()
    try {
      const res = await searchPatientsByPhoneNumber(searchPhoneInput.trim())
      if (res.success && res.patients) {
        if (res.patients.length === 1) {
          fillFormWithPatientData(res.patients[0])
          toast.success("Patient loaded.")
        } else {
          setSearchedPatientResults(res.patients)
          toast.info("Select patient from list.")
        }
      } else toast.error(res.message || "No match.")
    } catch (e) {
      //  console.error(e) // Already handled by the catch block
      toast.error("Phone search failed.")
    } finally {
      setIsSearching(false)
    }
  }

  const sendWhatsAppConfirmation = async (
    patientName: string,
    phoneNumber: string,
    uhid: string | null,
    billNo: number | null,
    appointmentType: "visithospital" | "oncall",
    modalities: ModalitySelection[], // Now contains doctor name
    totalCharges: number,
    discount: number
  ) => {
    const apiUrl = "https://a.infispark.in/send-text"
    const token = "9958399157" // Your API token
    const formattedPhoneNumber = `91${phoneNumber}` // Assuming Indian numbers and API expects 91 prefix

    let message = `*Dear ${patientName},*\n\n`

    if (appointmentType === "visithospital") {
      message += `Your *OPD appointment* has been successfully booked at Medford Hospital.\n\n`
      if (uhid) message += `*UHID:* ${uhid}\n`
      if (billNo) message += `*Bill No:* ${billNo}\n\n`

      if (modalities && modalities.length > 0) {
        message += `*Services Booked:*\n`
        modalities.forEach((modality, index) => {
          // modality.doctor is already the name here because of `onValueChange` logic
          const doctorName = modality.doctor || "N/A"
          const serviceName = modality.service || modality.type; // Use custom service name if available, otherwise modality type
          message += `  ${index + 1}. *${serviceName}* (Dr. ${doctorName}) - ₹${modality.charges}\n`
        })
        message += `\n*Total Charges:* ₹${totalCharges}\n`
        if (discount > 0) {
          message += `*Discount Applied:* ₹${discount}\n`
          message += `*Amount Payable:* ₹${totalCharges - discount}\n`
        } else {
          message += `*Amount Payable:* ₹${totalCharges}\n`
        }
      }
      message += `\nWe look forward to your visit!`
    } else {
      message += `Your *On-Call appointment* has been successfully registered.\n`
      if (uhid) message += `*UHID:* ${uhid}\n`
      message += `\nOur team will contact you shortly.`
    }
    message += `\n\n*Thank you for choosing Medford Hospital.*`

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: token,
          number: formattedPhoneNumber,
          message: message,
        }),
      })

      const data = await response.json()
      if (data.status === "success") {
        toast.success("WhatsApp confirmation sent!")
      } else {
        console.error("WhatsApp API Error:", data.message)
        toast.warn(`Failed to send WhatsApp confirmation: ${data.message}`)
      }
    } catch (error) {
      console.error("Error sending WhatsApp message:", error)
      toast.warn("Could not send WhatsApp confirmation due to a network error.")
    }
  }

  // When submitting, format modalities for service_info as required
  const formatModalitiesForServiceInfo = (modalities: ModalitySelection[]) =>
    modalities.map((m) =>
      m.type === "consultation"
        ? { ...m, doctorId: undefined } // keep specialist/visitType as is for consultation
        : { ...m, specialist: undefined, visitType: undefined, doctorId: undefined }
    )

  const onSubmit = async (d: IFormInput) => {
    setIsLoading(true)
    try {
      if (!d.opdType) d.opdType = d.appointmentType === "visithospital" ? "OPD" : "On-Call"
      if (d.appointmentType === "visithospital" && !d.modalities.length) return toast.error("Add at least one service.")
      // Ensure doctor field for each modality is filled if it's a doctor-dependent type
      if (
        d.appointmentType === "visithospital" &&
        d.modalities.some(
          (m) =>
            (m.type === "consultation" || m.type === "casualty" || m.type === "custom") &&
            (!m.doctor || !String(m.doctor).trim())
        )
      ) {
        return toast.error("Doctor required for consultation, casualty, and custom services.");
      }

      const formattedModalities = formatModalitiesForServiceInfo(watchedModalities);
      // Always use selectedPatient if set
      const patientIdToUse = selectedPatient?.patient_id || null;
      const uhidToUse = selectedPatient?.uhid || null;
      const res = await createAppointment(
        d,
        formattedModalities, // Pass formatted modalities
        totalModalityCharges,
        calculateTotalAmountPaid(),
        patientIdToUse,
        uhidToUse,
      )

      if (!res.success) return toast.error(res.message)

      toast.success(`${res.message} ${res.uhid ? `UHID: ${res.uhid}` : ""}`)
      setLastUhid(res.uhid || null)
      setLastBillNo(res.billNo || null)
      setIsSubmitted(true)
      fetchInitialData() // Refresh on-call list after submission

      // Send WhatsApp confirmation with detailed information
      if (d.phone && d.name) {
        await sendWhatsAppConfirmation(
          d.name,
          d.phone,
          res.uhid || null,
          res.billNo || null,
          d.appointmentType,
          watchedModalities, // Pass modalities
          totalModalityCharges, // Pass total charges
          watchedDiscount || 0 // Pass discount with default value if undefined
        )
      }

      if (d.appointmentType === "visithospital" && res.uhid)
        await openBillInNewTabProgrammatically(
          { ...d, uhid: res.uhid },
          res.uhid,
          doctors.map((dr) => ({ id: dr.id, dr_name: dr.dr_name })),
          res.billNo || null,
        )

      setTimeout(() => {
        setIsSubmitted(false)
        resetFormForNewPatient()
        setLastUhid(null)
        setLastBillNo(null)
        setActiveTab("book")
      }, 3000)
    } catch (e: any) {
      console.error(e)
      toast.error(`Booking failed: ${e.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteOnCall = async (oncallId: string) => {
    setIsLoading(true)
    try {
      const res = await deleteOnCallAppointment(oncallId)
      if (res.success) {
        toast.success("On-call appointment deleted.")
        fetchInitialData() // Refresh on-call list
      } else {
        toast.error(res.message || "Failed to delete on-call appointment.")
      }
    } catch (error) {
      console.error("Error deleting on-call appointment:", error)
      toast.error("An error occurred while deleting.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdatePatientDetails = async () => {
    if (!selectedPatient) return
    
    setIsLoading(true)
    try {
      const formData = getValues()
      
      // Update patient details in the database
      const { error } = await supabase
        .from("patient_detail")
        .update({
          name: formData.name.trim(),
          number: Number(formData.phone) || null,
          age: formData.age !== undefined ? Number(formData.age) : null,
          age_unit: formData.ageUnit || null,
          gender: formData.gender || null,
          address: formData.address?.trim() || null,
        })
        .eq("patient_id", selectedPatient.patient_id)
        .eq("uhid", selectedPatient.uhid)

      if (error) {
        console.error("Error updating patient details:", error)
        throw error
      }

      // Update the selectedPatient state with new data
      const updatedPatient: PatientDetail = {
        ...selectedPatient,
        name: formData.name.trim(),
        number: formData.phone || "",
        age: formData.age !== undefined && !isNaN(Number(formData.age)) ? Number(formData.age) : undefined,
        age_unit: formData.ageUnit || undefined,
        gender: formData.gender || undefined,
        address: formData.address?.trim() || undefined,
      }
      setSelectedPatient(updatedPatient)
      
      setIsEditingPatient(false)
      toast.success("Patient details updated successfully!")
    } catch (error: any) {
      console.error("Failed to update patient details:", error)
      toast.error(`Failed to update patient details: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const bookOnCallToOnCall = (appointment: OnCallAppointment) => {
    // FIX: Add null check for patient_detail
    if (appointment.patient_detail) {
      fillFormWithPatientData(appointment.patient_detail)
    } else {
      toast.error("Patient details missing for this on-call appointment.")
      return
    }
    setValue("appointmentType", "oncall")
    setValue("opdType", "On-Call")
    setValue("referredBy", appointment.referredBy || "")
    setValue("additionalNotes", appointment.additional_notes || "")
    setValue("date", new Date())
    setValue("time", formatAMPM(new Date()))
    toast.info("Patient loaded for new On-Call booking.")
  }

  const bookOnCallToOPD = (appointment: OnCallAppointment) => {
    // FIX: Add null check for patient_detail
    if (appointment.patient_detail) {
      fillFormWithPatientData(appointment.patient_detail)
    } else {
      toast.error("Patient details missing for this on-call appointment.")
      return
    }
    setValue("appointmentType", "visithospital")
    setValue("opdType", "OPD")
    setValue("referredBy", appointment.referredBy || "")
    setValue("additionalNotes", appointment.additional_notes || "")
    setValue("modalities", [])
    setValue("date", new Date())
    setValue("time", formatAMPM(new Date()))
    toast.info("Patient loaded for new OPD visit.")
  }

  /* -------------------------------- UI -------------------------------- */
  if (isSubmitted)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-emerald-50 p-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardContent className="pt-8 text-center space-y-4">
            <CheckCircle className="h-20 w-20 text-green-500 mx-auto animate-bounce" />
            <h2 className="text-3xl font-bold text-green-700">Appointment Registered!</h2>
            {lastUhid && (
              <p className="text-base font-semibold text-blue-700">
                UHID: <span className="font-mono text-xl">{lastUhid}</span>
                {lastBillNo !== null && (
                  <>
                    {" | "}Bill No: <span className="font-mono text-xl">{lastBillNo}</span>
                  </>
                )}
              </p>
            )}
            <p className="text-gray-500 text-sm">Resetting form ...</p>
          </CardContent>
        </Card>
      </div>
    )

  return (
    <Layout>
      <ToastContainer />
      {/* HEADER */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex gap-4 items-center">
            <div className="h-12 w-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center shadow-inner">
              <Hospital className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight">OPD Management System</h1>
              <p className="text-sm text-blue-100">Professional Healthcare Management</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-blue-100">
            <Clock className="h-4 w-4" />
            <span>
              {new Date().toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* SEARCH PATIENT */}
        <Card className="shadow-xl rounded-xl overflow-hidden animate-in fade-in zoom-in duration-500">
          <CardHeader className="bg-blue-50 border-b border-blue-200 py-4">
            <CardTitle className="flex items-center gap-3 text-lg text-blue-800">
              <Search className="h-5 w-5" />
              Search Existing Patient
              {selectedPatient && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetFormForNewPatient}
                  className="ml-auto text-red-600 hover:text-red-700 flex items-center gap-1 transition-colors duration-200"
                >
                  <XCircle className="h-4 w-4" /> Clear Patient
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="search-uhid">Search by UHID</Label>
                <div className="flex gap-2">
                  <Input
                    id="search-uhid"
                    placeholder="Enter UHID or counter number (e.g., MG-070625-00001 or 00001)"
                    value={searchUhIdInput}
                    onChange={(e) => setSearchUhIdInput(e.target.value)}
                    disabled={isSearching || !!selectedPatient}
                    className="h-10"
                  />
                  <Button
                    onClick={handleSearchByUhId}
                    disabled={isSearching || !!selectedPatient}
                    className="min-w-[100px]"
                  >
                    {isSearching ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="search-phone">Search by Phone</Label>
                <div className="flex gap-2">
                  <Input
                    key={`phone-${isEditingPatient}`}
                    id="search-phone"
                    placeholder="Enter 10-digit phone number"
                    value={searchPhoneInput}
                    onChange={(e) => setSearchPhoneInput(e.target.value)}
                    disabled={isSearching || !!selectedPatient}
                    className="h-10"
                  />
                  <Button
                    onClick={handleSearchByPhoneNumber}
                    disabled={isSearching || !!selectedPatient}
                    className="min-w-[100px]"
                  >
                    {isSearching ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>
            </div>
            {searchedPatientResults && (
              <>
                <Separator className="bg-gray-200" />
                <div className="space-y-2">
                  <Label>Select Patient from Results</Label>
                  <Select
                    onValueChange={(v) => {
                      const sel = searchedPatientResults.find((p) => p.uhid === v)
                      if (sel) {
                        fillFormWithPatientData(sel)
                        toast.success(`Selected: ${sel.name}`)
                      }
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Choose patient" />
                    </SelectTrigger>
                    <SelectContent>
                      {searchedPatientResults.map((p) => (
                        <SelectItem key={p.uhid} value={p.uhid}>
                          {p.name} ({p.uhid}) – {p.number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {selectedPatient && (
              <>
                <Separator className="bg-gray-200" />
                <div className="bg-blue-100 p-4 rounded-lg flex items-center justify-between text-base text-blue-900 border border-blue-200">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-blue-600" />
                    Selected Patient: <span className="font-semibold">{selectedPatient.name}</span> (UHID:{" "}
                    <span className="font-mono font-bold">{selectedPatient.uhid}</span>)
                  </span>
                  <div className="flex gap-2">
                    {!isEditingPatient ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsEditingPatient(true)
                        }}
                        className="text-blue-600 border-blue-500 hover:bg-blue-50"
                      >
                        Edit Details
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsEditingPatient(false)}
                          className="text-gray-600 border-gray-500 hover:bg-gray-50"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleUpdatePatientDetails}
                          disabled={isLoading}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {isLoading ? "Updating..." : "Update Details"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {!isEditingPatient && (
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-700">
                      💡 <strong>Tip:</strong> Click "Edit Details" to modify this patient's information before booking the appointment.
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* MAIN TABS */}
        <Card className="shadow-xl rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-700">
          <CardHeader className="bg-gradient-to-r from-blue-700 to-purple-700 text-white py-4">
            <CardTitle className="text-xl lg:text-2xl font-bold">Patient Management Dashboard</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-2 border-b rounded-none h-14 bg-gray-50">
                <TabsTrigger
                  value="book"
                  className="flex items-center gap-2 text-lg data-[state=active]:bg-white data-[state=active]:shadow-inner data-[state=active]:border-b-2 data-[state=active]:border-blue-600 transition-all duration-300"
                >
                  <Hospital className="h-5 w-5" />
                  Book Appointment
                </TabsTrigger>
                <TabsTrigger
                  value="oncall"
                  className="flex items-center gap-2 text-lg data-[state=active]:bg-white data-[state=active]:shadow-inner data-[state=active]:border-b-2 data-[state=active]:border-blue-600 transition-all duration-300"
                >
                  <PhoneCall className="h-5 w-5" />
                  On-Call List ({onCallAppointments.length})
                </TabsTrigger>
              </TabsList>

              {/* BOOK TAB CONTENT */}
              <TabsContent value="book" className="p-6">
                <FormProvider {...form}>
                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                    {/* PATIENT INFO */}
                    <Card className="border-l-4 border-blue-600 shadow-md transition-all duration-300 hover:shadow-lg">
                      <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-3 text-xl text-blue-700">
                          <User className="h-6 w-6" />
                          Patient Information
                          {isEditingPatient && (
                            <Badge variant="secondary" className="ml-2 bg-yellow-100 text-yellow-800 border-yellow-300">
                              Editing Mode
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {isEditingPatient && selectedPatient && (
                          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                            <p className="text-sm text-yellow-700">
                              ✏️ <strong>Editing Mode:</strong> You can now modify the patient's details. Click "Update Details" to save changes.
                            </p>
                          </div>
                        )}
                        <div className="grid lg:grid-cols-3 md:grid-cols-2 gap-6">
                          {/* NAME */}
                          <div className="space-y-2">
                            <Label htmlFor="patient-name">
                              Patient Name <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                              <PersonIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                              <Controller
                                control={control}
                                name="name"
                                rules={{ required: "Name is required" }}
                                render={({ field }) => (
                                  <Input
                                    key={`name-${isEditingPatient}`}
                                    id="patient-name"
                                    type="text"
                                    {...field}
                                    ref={(el) => {
                                      field.ref(el)
                                      nameInputRef.current = el
                                    }}
                                    placeholder="Enter patient name"
                                    className={`pl-10 h-10 ${errors.name ? "border-red-500" : ""} ${
                                      isEditingPatient && selectedPatient ? "border-yellow-400 bg-yellow-50" : ""
                                    }`}
                                    autoComplete="off"
                                    disabled={selectedPatient ? !isEditingPatient : false}
                                  />
                                )}
                              />
                            </div>
                            {errors.name && <p className="text-red-500 text-sm">{errors.name.message}</p>}
                          </div>
                          {/* PHONE */}
                          <div className="space-y-2">
                            <Label htmlFor="phone-number">
                              Phone Number <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                              <Controller
                                control={control}
                                name="phone"
                                rules={{
                                  required: "Phone number is required",
                                  pattern: { value: /^[0-9]{10}$/, message: "Enter a valid 10-digit number" },
                                }}
                                render={({ field }) => (
                                  <Input
                                    key={`phone-${isEditingPatient}`}
                                    id="phone-number"
                                    type="tel"
                                    {...field}
                                    ref={(el) => {
                                      field.ref(el)
                                      phoneInputRef.current = el
                                    }}
                                    placeholder="10-digit number"
                                    className={`pl-10 h-10 ${errors.phone ? "border-red-500" : ""} ${
                                      isEditingPatient && selectedPatient ? "border-yellow-400 bg-yellow-50" : ""
                                    }`}
                                    autoComplete="off"
                                    disabled={selectedPatient ? !isEditingPatient : false}
                                  />
                                )}
                              />
                            </div>
                            {errors.phone && <p className="text-red-500 text-sm">{errors.phone.message}</p>}
                          </div>
                          {/* AGE + UNIT */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="patient-age">
                                Age <span className="text-red-500">*</span>
                              </Label>
                              <div className="relative">
                                <Cake className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                                <Controller
                                  control={control}
                                  name="age"
                                  rules={{
                                    required: "Age is required",
                                    min: { value: 0, message: "Positive value only" },
                                  }}
                                  render={({ field }) => (
                                    <Input
                                      key={`age-${isEditingPatient}`}
                                      id="patient-age"
                                      type="number"
                                      {...field}
                                      onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                                      placeholder="Age"
                                      className={`pl-10 h-10 ${errors.age ? "border-red-500" : ""} ${
                                        isEditingPatient && selectedPatient ? "border-yellow-400 bg-yellow-50" : ""
                                      }`}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      disabled={selectedPatient ? !isEditingPatient : false}
                                    />
                                  )}
                                />
                              </div>
                              {errors.age && <p className="text-red-500 text-sm">{errors.age.message}</p>}
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="age-unit">
                                Unit <span className="text-red-500">*</span>
                              </Label>
                              <Controller
                                control={control}
                                name="ageUnit"
                                rules={{ required: "Unit required" }}
                                render={({ field }) => (
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
                                    disabled={selectedPatient ? !isEditingPatient : false}
                                  >
                                    <SelectTrigger
                                      id="age-unit"
                                      className={`h-10 ${errors.ageUnit ? "border-red-500" : ""}`}
                                    >
                                      <SelectValue placeholder="Unit" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {AgeUnitOptions.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                          {o.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              />
                              {errors.ageUnit && <p className="text-red-500 text-sm">{errors.ageUnit.message}</p>}
                            </div>
                          </div>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                          {/* GENDER */}
                          <div className="space-y-2">
                            <Label htmlFor="patient-gender">
                              Gender <span className="text-red-500">*</span>
                            </Label>
                            <Controller
                              control={control}
                              name="gender"
                              rules={{ required: "Gender required" }}
                              render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value} disabled={selectedPatient ? !isEditingPatient : false}>
                                  <SelectTrigger
                                    id="patient-gender"
                                    className={`h-10 ${errors.gender ? "border-red-500" : ""}`}
                                  >
                                    <SelectValue placeholder="Gender" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {GenderOptions.map((o) => (
                                      <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                            {errors.gender && <p className="text-red-500 text-sm">{errors.gender.message}</p>}
                          </div>
                          {/* APPOINTMENT TYPE */}
                          <div className="space-y-2">
                            <Label>
                              Appointment Type <span className="text-red-500">*</span>
                            </Label>
                            <Controller
                              control={control}
                              name="appointmentType"
                              rules={{ required: "Required" }}
                              render={({ field }) => (
                                <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-6">
                                  <div
                                    className={`flex-1 border rounded-lg p-3 cursor-pointer transition-all duration-200 ${
                                      field.value === "visithospital"
                                        ? "border-blue-500 bg-blue-50 shadow-md"
                                        : "border-gray-200 hover:border-gray-300"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <RadioGroupItem value="visithospital" id="visithospital" />
                                      <Label htmlFor="visithospital">Visit Hospital</Label>
                                    </div>
                                  </div>
                                  <div
                                    className={`flex-1 border rounded-lg p-3 cursor-pointer transition-all duration-200 ${
                                      field.value === "oncall"
                                        ? "border-blue-500 bg-blue-50 shadow-md"
                                        : "border-gray-200 hover:border-gray-300"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <RadioGroupItem value="oncall" id="oncall" />
                                      <Label htmlFor="oncall">On-Call</Label>
                                    </div>
                                  </div>
                                </RadioGroup>
                              )}
                            />
                            {errors.appointmentType && (
                              <p className="text-sm text-red-500">{errors.appointmentType.message}</p>
                            )}
                          </div>
                        </div>
                        {/* Address and Referred By */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <Label htmlFor="referredBy" className="text-sm font-medium">
                              Referred By
                            </Label>
                            <Input
                              id="referredBy"
                              type="text"
                              {...register("referredBy")}
                              placeholder="Referrer name"
                              className="h-10"
                            />
                          </div>
                          {watchedAppointmentType === "visithospital" && (
                            <div className="space-y-2">
                              <Label htmlFor="address" className="text-sm font-medium">
                                Address
                              </Label>
                              <div className="relative">
                                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                                <Controller
                                  control={control}
                                  name="address"
                                  render={({ field }) => (
                                    <Textarea
                                      id="address"
                                      {...field}
                                      placeholder="Enter address (optional)"
                                      className={`pl-10 min-h-[60px] ${
                                        isEditingPatient && selectedPatient ? "border-yellow-400 bg-yellow-50" : ""
                                      }`}
                                      disabled={selectedPatient ? !isEditingPatient : false}
                                    />
                                  )}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Medical Services Section */}
                    {watchedAppointmentType === "visithospital" && (
                      <Card className="border-l-4 border-emerald-600 shadow-md transition-all duration-300 hover:shadow-lg">
                        <CardHeader className="pb-4">
                          <CardTitle className="flex items-center gap-3 text-xl text-emerald-700">
                            <Stethoscope className="h-6 w-6" />
                            Medical Services
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <Label className="text-sm font-medium mb-3 block">Quick Add Services</Label>
                          <div className="flex flex-wrap gap-2 mb-4">
                            {ModalityOptions.map((modality) => (
                              <Button
                                key={modality.value}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => addModality(modality.value as ModalitySelection["type"])}
                                className="text-xs transition-colors duration-200 hover:bg-blue-500 hover:text-white"
                              >
                                {modality.label}
                              </Button>
                            ))}
                          </div>
                          {fields.length === 0 && (
                            <p className="text-gray-500 text-center py-4 text-sm">
                              Add services to book an appointment.
                            </p>
                          )}
                          <div className="space-y-4">
                            {fields.map((modality, index) => (
                              <Card key={modality.id} className="border border-dashed border-gray-300 relative">
                                <CardContent className="p-4 space-y-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <Badge variant="secondary" className="capitalize text-sm px-3 py-1">
                                      {modality.type}
                                    </Badge>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeModality(index)}
                                      className="text-red-600 hover:text-red-700 transition-colors duration-200"
                                    >
                                      <Trash2 className="h-4 w-4 mr-1" /> Remove
                                    </Button>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {/* Doctor selection */}
                                    <div className="space-y-2">
                                      <Label className="text-xs">
                                        Doctor <span className="text-red-500">*</span>
                                      </Label>
                                      <SearchableSelect
                                        options={doctors.map((doctor) => ({ value: doctor.id, label: doctor.dr_name }))}
                                        value={modality.doctorId || ""}
                                        onValueChange={(doctorId: string) => {
                                          const selectedDoctor = doctors.find((d) => d.id === doctorId);
                                          updateModalityField(index, "doctorId", doctorId);
                                          updateModalityField(index, "doctor", selectedDoctor?.dr_name || "");
                                          // Automatically set specialist if available
                                          if (selectedDoctor?.specialist) {
                                            updateModalityField(index, "specialist", selectedDoctor.specialist);
                                          }
                                          // Automatically set charges for consultation if doctor has default charges
                                          if (modality.type === "consultation" && selectedDoctor?.opd_charge) {
                                            updateModalityField(index, "charges", selectedDoctor.opd_charge);
                                            updateModalityField(index, "visitType", "first"); // Default to first visit
                                          }
                                        }}
                                        placeholder="Select doctor"
                                        className={`h-9 text-sm ${errors.modalities?.[index]?.doctor ? "border-red-500" : ""}`}
                                      />
                                      {errors.modalities?.[index]?.doctor && (
                                        <p className="text-sm text-red-500">
                                          {errors.modalities[index]?.doctor?.message}
                                        </p>
                                      )}
                                    </div>
                                    {modality.type === "consultation" ? (
                                      <>
                                        <div className="space-y-2">
                                          <Label className="text-xs">Specialist</Label>
                                          <SearchableSelect
                                            options={Array.from(new Set(doctors.flatMap((d) => d.specialist))).map((spec) => ({ value: spec, label: spec }))}
                                            value={modality.specialist || ""}
                                            onValueChange={(value) => updateModalityField(index, "specialist", value)}
                                            placeholder="Select specialist"
                                            className="h-9 text-sm"
                                          />
                                          {errors.modalities?.[index]?.specialist && (
                                            <p className="text-sm text-red-500">
                                              {errors.modalities[index]?.specialist?.message}
                                            </p>
                                          )}
                                        </div>
                                        <div className="space-y-2">
                                          <Label className="text-xs">Visit Type</Label>
                                          <SearchableSelect
                                            options={[
                                              { value: "first", label: "First Visit" },
                                              { value: "followup", label: "Follow Up" },
                                            ]}
                                            value={modality.visitType || ""}
                                            onValueChange={(value) => {
                                              const doctor = doctors.find((d) => d.dr_name === modality.doctor) // Find by name
                                              let charges = 0
                                              if (doctor?.charges?.[0]) {
                                                const chargeData = doctor.charges[0]
                                                if (value === "first" && chargeData.firstVisitCharge !== undefined) {
                                                  charges = chargeData.firstVisitCharge
                                                } else if (
                                                  value === "followup" &&
                                                  chargeData.followUpCharge !== undefined
                                                ) {
                                                  charges = chargeData.followUpCharge
                                                }
                                              }
                                              updateModalityField(index, "visitType", value as "first" | "followup")
                                              updateModalityField(index, "charges", charges)
                                            }}
                                            placeholder="Select visit type"
                                            className="h-9 text-sm"
                                          />
                                          {errors.modalities?.[index]?.visitType && (
                                            <p className="text-sm text-red-500">
                                              {errors.modalities[index]?.visitType?.message}
                                            </p>
                                          )}
                                        </div>
                                      </>
                                    ) : modality.type === "custom" ? (
                                      <div className="space-y-2 col-span-2">
                                        <Label className="text-xs">
                                          Custom Service Name <span className="text-red-500">*</span>
                                        </Label>
                                        {/* Use the new custom EditableServiceNameInput component */}
                                        <EditableServiceNameInput
                                          value={modality.service || ""}
                                          onSave={(newValue) => handleSaveServiceName(index, newValue)}
                                          index={index}
                                          isCurrentlyEditing={editingServiceNameIndex === index}
                                          onEditStart={setEditingServiceNameIndex}
                                          onEditEnd={() => setEditingServiceNameIndex(null)}
                                          error={errors.modalities?.[index]?.service?.message}
                                          placeholder="Enter custom service name"
                                        />
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        <Label className="text-xs">
                                          Service <span className="text-red-500">*</span>
                                        </Label>
                                        <SearchableSelect
                                          options={getServiceOptions(modality.type).map((service) => ({ value: service.service, label: `${service.service} - ₹${service.amount}` }))}
                                          value={modality.service || ""}
                                          onValueChange={(value) => {
                                            const serviceOptions = getServiceOptions(modality.type)
                                            const selectedService = serviceOptions.find((s) => s.service === value)
                                            updateModalityField(index, "service", value)
                                            updateModalityField(index, "charges", selectedService?.amount || 0)
                                          }}
                                          placeholder="Select service"
                                          className="h-9 text-sm"
                                        />
                                        {errors.modalities?.[index]?.service && (
                                          <p className="text-sm text-red-500">
                                            {errors.modalities[index]?.service?.message}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                    <div className="space-y-2">
                                      <Label className="text-xs">
                                        Charges (₹) <span className="text-red-500">*</span>
                                      </Label>
                                      {/* Use the custom EditableChargesInput component */}
                                      <EditableChargesInput
                                        value={modality.charges}
                                        onSave={(newValue) => handleSaveCharges(index, newValue)}
                                        index={index}
                                        isCurrentlyEditing={editingChargeIndex === index}
                                        onEditStart={setEditingChargeIndex}
                                        onEditEnd={() => setEditingChargeIndex(null)}
                                        error={errors.modalities?.[index]?.charges?.message}
                                      />
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                          {fields.length > 0 && (
                            <div className="bg-blue-50 p-4 rounded-lg mt-6 shadow-sm border border-blue-200">
                              <div className="flex justify-between items-center">
                                <span className="font-medium text-blue-900 text-lg">Total Services Charges:</span>
                                <span className="text-2xl font-bold text-blue-900">₹{totalModalityCharges}</span>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Payment Section */}
                    {watchedAppointmentType === "visithospital" && (
                      <Card className="border-l-4 border-purple-600 shadow-md transition-all duration-300 hover:shadow-lg">
                        <CardHeader className="pb-4">
                          <CardTitle className="flex items-center gap-3 text-xl text-purple-700">
                            <CreditCard className="h-6 w-6" />
                            Payment Information
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {/* Payment Method */}
                            <div className="space-y-2">
                              <Label htmlFor="paymentMethod" className="text-sm font-medium">
                                Payment Method <span className="text-red-500">*</span>
                              </Label>
                              <Controller
                                control={control}
                                name="paymentMethod"
                                rules={{
                                  required: "Payment method is required",
                                }}
                                render={({ field }) => (
                                  <Select onValueChange={field.onChange} value={field.value || "cash"}>
                                    <SelectTrigger
                                      id="paymentMethod"
                                      className={`h-10 ${errors.paymentMethod ? "border-red-500" : ""}`}
                                    >
                                      <SelectValue placeholder="Select method" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {PaymentOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              />
                              {errors.paymentMethod && (
                                <p className="text-sm text-red-500">{errors.paymentMethod.message}</p>
                              )}
                            </div>
                            {/* Total Charges */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Total Charges</Label>
                              <div className="relative">
                                <IndianRupeeIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                                <Input
                                  value={totalModalityCharges}
                                  readOnly
                                  className="pl-10 h-10 bg-gray-50 cursor-not-allowed font-semibold text-blue-600"
                                  onWheel={(e) => e.currentTarget.blur()}
                                />
                              </div>
                            </div>
                            {/* Cash Amount */}
                            {(watchedPaymentMethod === "cash" || watchedPaymentMethod === "mixed") && (
                              <div className="space-y-2">
                                <Label htmlFor="cashAmount" className="text-sm font-medium">
                                  Cash Amount <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                  <IndianRupeeIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                                  <Input
                                    id="cashAmount"
                                    type="number"
                                    placeholder="Cash amount"
                                    className={`pl-10 h-10 ${errors.cashAmount ? "border-red-500" : ""}`}
                                    {...register("cashAmount", {
                                      required:
                                        (watchedPaymentMethod === "cash" || watchedPaymentMethod === "mixed") &&
                                        totalModalityCharges > 0
                                          ? "Cash amount is required"
                                          : false,
                                      min: { value: 0, message: "Positive value only" },
                                      valueAsNumber: true,
                                    })}
                                    onWheel={(e) => e.currentTarget.blur()}
                                  />
                                </div>
                                {errors.cashAmount && (
                                  <p className="text-sm text-red-500">{errors.cashAmount.message}</p>
                                )}
                              </div>
                            )}
                            {/* Online Amount */}
                            {(watchedPaymentMethod === "online" ||
                              watchedPaymentMethod === "card-credit" ||
                              watchedPaymentMethod === "card-debit" ||
                              watchedPaymentMethod === "mixed") && (
                              <div className="space-y-2">
                                <Label htmlFor="onlineAmount" className="text-sm font-medium">
                                  {watchedPaymentMethod === "online" ||
                                  watchedPaymentMethod === "card-credit" ||
                                  watchedPaymentMethod === "card-debit" ||
                                  watchedPaymentMethod === "mixed"
                                    ? "Online Amount"
                                    : "Amount"}{" "}
                                  <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                  <IndianRupeeIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                                  <Input
                                    id="onlineAmount"
                                    type="number"
                                    placeholder="Online amount"
                                    className={`pl-10 h-10 ${errors.onlineAmount ? "border-red-500" : ""}`}
                                    {...register("onlineAmount", {
                                      required:
                                        (watchedPaymentMethod === "online" ||
                                          watchedPaymentMethod === "card-credit" ||
                                          watchedPaymentMethod === "card-debit" ||
                                          watchedPaymentMethod === "mixed") &&
                                        totalModalityCharges > 0
                                          ? "Amount is required"
                                          : false,
                                      min: { value: 0, message: "Amount must be positive" },
                                      valueAsNumber: true,
                                    })}
                                    onWheel={(e) => e.currentTarget.blur()}
                                  />
                                </div>
                                {errors.onlineAmount && (
                                  <p className="text-sm text-red-500">{errors.onlineAmount.message}</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {/* Cash Through */}
                            {(watchedPaymentMethod === "cash" || watchedPaymentMethod === "mixed") && (
                              <div className="space-y-2">
                                <Label htmlFor="cashThrough" className="text-sm font-medium">
                                  Cash Through
                                </Label>
                                <Controller
                                  control={control}
                                  name="cashThrough"
                                  render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value || "cash"}>
                                      <SelectTrigger id="cashThrough" className="h-10">
                                        <SelectValue placeholder="Select cash method" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CashThroughOptions.map((option) => (
                                          <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                              </div>
                            )}
                            {/* Online Through */}
                            {(watchedPaymentMethod === "online" || watchedPaymentMethod === "mixed") && (
                              <div className="space-y-2">
                                <Label htmlFor="onlineThrough" className="text-sm font-medium">
                                  Online Through
                                </Label>
                                <Controller
                                  control={control}
                                  name="onlineThrough"
                                  render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value || "upi"}>
                                      <SelectTrigger id="onlineThrough" className="h-10">
                                        <SelectValue placeholder="Select online method" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {OnlineThroughOptions.map((option) => (
                                          <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                              </div>
                            )}
                            {/* Discount */}
                            <div className="space-y-2">
                              <Label htmlFor="discount" className="text-sm font-medium">
                                Discount (Auto)
                              </Label>
                              <div className="relative">
                                <IndianRupeeIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                                <Input
                                  id="discount"
                                  type="number"
                                  placeholder="Auto-calculated"
                                  className="pl-10 h-10 bg-gray-50 cursor-not-allowed"
                                  value={watchedDiscount === 0 ? "" : watchedDiscount}
                                  readOnly
                                  onWheel={(e) => e.currentTarget.blur()}
                                />
                              </div>
                            </div>
                          </div>
                          {/* Payment Summary */}
                          {totalModalityCharges > 0 && (
                            <Card className="bg-gradient-to-r from-blue-50 to-emerald-50 border-blue-200 shadow-sm mt-6">
                              <CardContent className="p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm items-center">
                                  <div className="flex flex-col">
                                    <span className="text-gray-700">Total Charges:</span>
                                    <span className="font-semibold text-lg text-blue-900">₹{totalModalityCharges}</span>
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-gray-700">Discount:</span>
                                    <span className="text-red-600 font-semibold text-lg">
                                      -₹{Number(watchedDiscount) || 0}
                                    </span>
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-gray-700">Amount to Pay:</span>
                                    <span className="font-semibold text-lg text-blue-900">
                                      ₹{totalModalityCharges - (Number(watchedDiscount) || 0)}
                                    </span>
                                  </div>
                                  <div className="flex flex-col text-xl font-bold text-emerald-700">
                                    <span>Amount Paid:</span>
                                    <span>₹{calculateTotalAmountPaid()}</span>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Additional Notes */}
                    <Card className="border-l-4 border-orange-600 shadow-md transition-all duration-300 hover:shadow-lg">
                      <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-3 text-xl text-orange-700">
                          <FileText className="h-6 w-6" />
                          Additional Notes
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <Label htmlFor="additionalNotes" className="text-sm font-medium">
                            Notes & Comments
                          </Label>
                          <div className="relative">
                            <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                            <Textarea
                              id="additionalNotes"
                              {...register("additionalNotes")}
                              placeholder="Enter any additional notes, special instructions, or comments (optional)"
                              className="pl-10 min-h-[80px]"
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Submit */}
                    <div className="flex justify-end pt-6 border-t border-gray-200 bg-gray-50 -mx-6 px-6 -mb-6 pb-6">
                      <Button
                        type="submit"
                        disabled={isLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-10 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 min-w-[200px] text-lg"
                      >
                        {isLoading ? (
                          <div className="flex items-center gap-2">
                            <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Processing...
                          </div>
                        ) : watchedAppointmentType === "oncall" ? (
                          "Register On-Call"
                        ) : (
                          "Book Appointment"
                        )}
                      </Button>
                    </div>
                  </form>
                </FormProvider>
              </TabsContent>

              {/* On-Call List Tab */}
              <TabsContent value="oncall" className="p-6 mt-0">
                <Card className="shadow-md rounded-lg border-none">
                  <CardHeader className="bg-orange-50 border-b border-orange-200 py-4">
                    <CardTitle className="flex items-center gap-3 text-xl text-orange-800">
                      <PhoneCall className="h-6 w-6" />
                      On-call Appointments ({onCallAppointments.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    {onCallAppointments.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 text-lg flex flex-col items-center gap-2">
                        <FileText className="h-8 w-8 text-gray-400" />
                        No on-call appointments found.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {onCallAppointments.map((appointment) => (
                          <Card key={appointment.oncall_id} className="border-l-4 border-orange-500 shadow-sm">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start flex-wrap gap-4">
                                <div className="space-y-2 flex-1 min-w-0">
                                  <h3 className="font-semibold text-xl text-gray-800">
                                    {appointment.patient_detail?.name || "N/A"}
                                  </h3>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
                                    <p className="flex items-center gap-1">
                                      <Phone className="h-4 w-4 text-gray-500 shrink-0" />
                                      <span className="break-all">{appointment.patient_detail?.number || "N/A"}</span>
                                    </p>
                                    <p className="flex items-center gap-1">
                                      <Calendar className="h-4 w-4 text-gray-500 shrink-0" />
                                      Age: {appointment.patient_detail?.age || "N/A"}{" "}
                                      {appointment.patient_detail?.age_unit}
                                    </p>
                                    <p className="flex items-center gap-1">
                                      <User className="h-4 w-4 text-gray-500 shrink-0" />
                                      Gender: {appointment.patient_detail?.gender || "N/A"}
                                    </p>
                                    <p className="flex items-center gap-1">
                                      <User className="h-4 w-4 text-gray-500 shrink-0" />
                                      Referred by:{" "}
                                      <span className="font-medium">{appointment.referredBy || "Self"}</span>
                                    </p>
                                    {appointment.additional_notes && (
                                      <p className="flex items-start gap-1 col-span-full">
                                        <FileText className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
                                        Notes: <span className="text-gray-700">{appointment.additional_notes}</span>
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col space-y-3 min-w-[150px]">
                                  <Button
                                    size="sm"
                                    onClick={() => bookOnCallToOnCall(appointment)}
                                    className="bg-orange-600 hover:bg-orange-700 transition-colors duration-200"
                                  >
                                    Book On-call
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => bookOnCallToOPD(appointment)}
                                    className="border-blue-500 text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors duration-200"
                                  >
                                    Book OPD Visit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleDeleteOnCall(appointment.oncall_id)}
                                    className="text-red-600 border-red-500 hover:bg-red-50 hover:text-red-700 transition-colors duration-200"
                                    disabled={isLoading}
                                  >
                                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}
export default AppointmentPage