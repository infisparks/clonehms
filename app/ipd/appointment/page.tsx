"use client"

import type React from "react"
import { useState, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { User, Phone, Calendar, Bed, Eye, XCircle, AlertCircle, Wallet } from "lucide-react" // Added Wallet icon
import Layout from "@/components/global/Layout"
import { supabase } from "@/lib/supabase"
import { toast } from "sonner"
import { SearchableSelect } from "@/components/global/searchable-select"
import IPDSignaturePDF from "@/app/ipd/appointment/pdf"
import { generateNextUHID } from "@/components/uhid-generator"

// --- Type Definitions (Defined directly in this file) ---

interface Option {
  value: string; // Changed to string as IDs are converted for select component
  label: string;
}

interface PatientDetail {
  patient_id: number;
  created_at: string;
  name: string;
  number: number | null; // Matches bigint in DB
  age: number | null; // Matches integer in DB
  gender: string | null;
  address: string | null;
  age_unit: string | null;
  dob: string | null;
  uhid: string;
  updated_at: string | null;
}

interface Doctor {
  id: number; // Changed to number to match DB schema
  created_at: string;
  dr_name: string;
  department: string;
  specialist: any; // Assuming JSON type, can be more specific if schema is known
  charges: any; // Assuming JSON type, can be more specific if schema is known
}

interface BedData {
  id: number; // Changed to number to match DB schema
  created_at: string;
  room_type: string;
  bed_number: number;
  bed_type: string;
  status: "available" | "occupied" | "maintenance" | "reserved";
}

interface PaymentDetailItem {
  date: string;
  type: string; // This 'type' refers to the old type, like "deposit"
  amount: number;
  createdAt: string;
  paymentType: string;
  through: string; // Changed to required string to match PDF interface
  amountType?: "advance" | "deposit" | "settlement" | "refund" | "discount"; // New: explicit type for calculation/display
}

interface ServiceDetailItem {
  type: string;
  amount: number;
  createdAt: string;
  doctorName: string;
  serviceName: string;
}

interface IPDFormInput {
  uhid: string;
  name: string;
  phone: string | number | null; // Use string for input, convert to number for DB
  age: string | number | null; // Use string for input, convert to number for DB
  ageUnit: string;
  gender: string | null;
  address: string | null;
  relativeName: string;
  relativePhone: string | number | null; // Use string for input, convert to number for DB
  relativeAddress: string | null;
  admissionSource: string;
  admissionType: string;
  referralDoctor: string;
  underCareOfDoctor: string; // Changed to store doctor name (as string)
  depositAmount: string | number | null; // Use string for input, convert to number for DB
  paymentMode: string;
  through: string | null; // New: Added 'through' field
  bed: number | null; // Changed to number | null to match BedData.id and DB
  roomType: string;
  date: string;
  time: string;
  id?: number; // Optional for updates
  mrd?: string | null; // Added new field for MRD
  tpa?: boolean; // Added new field for TPA
}

// --- End Type Definitions ---

// Options for various form fields
const admissionSourceOptions: Option[] = [
  { value: "ipd", label: "IPD" },
  { value: "opd", label: "OPD" },
  { value: "casualty", label: "Casualty" },
  { value: "referral", label: "Referral" },
]

const admissionTypeOptions: Option[] = [
  { value: "general", label: "General" },
  { value: "surgery", label: "Surgery" },
  { value: "accident_emergency", label: "Accident/Emergency" },
  { value: "day_observation", label: "Day Observation" },
]

const paymentModeOptions: Option[] = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "mixed", label: "Cash + Online" }, // Consider if 'mixed' needs a 'through'
]

const genderOptions: Option[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
]

const ageUnitOptions: Option[] = [
  { value: "years", label: "Years" },
  { value: "months", label: "Months" },
  { value: "days", label: "Days" },
]

// New options for 'Through' field
const onlineThroughOptions: Option[] = [
  { value: "upi", label: "UPI" },
  { value: "credit-card", label: "Credit Card" },
  { value: "debit-card", label: "Debit Card" },
  { value: "netbanking", label: "Net Banking" },
  { value: "cheque", label: "Cheque" },
]

const cashThroughOptions: Option[] = [
  { value: "cash", label: "Cash" },
];


const IPDAppointmentPage = () => {
  const [patients, setPatients] = useState<PatientDetail[]>([])
  const [allDoctors, setAllDoctors] = useState<Doctor[]>([])
  const [beds, setBeds] = useState<BedData[]>([])
  const [availableBeds, setAvailableBeds] = useState<BedData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showAvailability, setShowAvailability] = useState(false)
  // Removed name-based dropdown suggestions; we now search by UHID/Phone
  // OPD-like search and edit states
  const [searchUhIdInput, setSearchUhIdInput] = useState("")
  const [searchPhoneInput, setSearchPhoneInput] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchedPatientResults, setSearchedPatientResults] = useState<PatientDetail[] | null>(null)
  const [selectedPatient, setSelectedPatient] = useState<PatientDetail | null>(null)
  const [isEditingPatient, setIsEditingPatient] = useState(false)

  const [formData, setFormData] = useState<IPDFormInput>({
    uhid: "", // Initialize uhid
    name: "",
    phone: "",
    age: "",
    ageUnit: "years", // Initialize ageUnit
    gender: null, // Initialize as null to match type
    address: null, // Initialize as null to match type
    relativeName: "",
    relativePhone: "",
    relativeAddress: null, // Initialize as null to match type
    admissionSource: "ipd", // Default to IPD
    admissionType: "general", // Default to General
    referralDoctor: "",
    underCareOfDoctor: "", // Will store doctor name as string
    depositAmount: "",
    paymentMode: "cash", // Default to Cash
    through: "cash", // New: Default 'through' to 'cash'
    roomType: "",
    bed: null, // Initialize as null to match type
    date: new Date().toISOString().split("T")[0],
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), // Default to current time (24-hour)
    mrd: null,
    tpa: false, // Initialize tpa to false
  })

  // Effect to automatically set 'through' when paymentMode changes
  useEffect(() => {
    if (formData.paymentMode === "cash") {
      setFormData((prev) => ({ ...prev, through: "cash" }));
    } else if (formData.paymentMode === "online") {
      setFormData((prev) => ({ ...prev, through: null })); // Clear or set a default for online
    }
  }, [formData.paymentMode]);

  // Place these INSIDE the component:
  const [roomTypeOptions, setRoomTypeOptions] = useState<Option[]>([]);

  useEffect(() => {
    const fetchRoomTypes = async () => {
      const { data, error } = await supabase
        .from("bed_management")
        .select("room_type")
        .neq("room_type", null);
      if (!error && data) {
        const uniqueTypes = Array.from(new Set(data.map((row) => row.room_type).filter(Boolean)));
        setRoomTypeOptions(
          uniqueTypes.map((type) => ({
            value: type,
            label: type.charAt(0).toUpperCase() + type.slice(1),
          }))
        );
      }
    };
    fetchRoomTypes();
  }, []);

  const genderOptions: Option[] = [
    { value: "male", label: "Male" },
    { value: "female", label: "Female" },
    { value: "other", label: "Other" },
  ]

  const ageUnitOptions: Option[] = [
    { value: "years", label: "Years" },
    { value: "months", label: "Months" },
    { value: "days", label: "Days" },
  ]

  // New options for 'Through' field
  const onlineThroughOptions: Option[] = [
    { value: "upi", label: "UPI" },
    { value: "credit-card", label: "Credit Card" },
    { value: "debit-card", label: "Debit Card" },
    { value: "netbanking", label: "Net Banking" },
    { value: "cheque", label: "Cheque" },
  ]

  const cashThroughOptions: Option[] = [
    { value: "cash", label: "Cash" },
  ];


  useEffect(() => {
    fetchPatients()
    fetchAllDoctors()
    fetchBeds()
  }, [])

  useEffect(() => {
    if (formData.roomType) {
      const roomBeds = beds.filter((bed) => bed.room_type === formData.roomType && bed.status === "available")
      setAvailableBeds(roomBeds)
    } else {
      setAvailableBeds([])
    }
  }, [formData.roomType, beds])


  // New useEffect to fetch patient details when UHID is set/changed
  const fetchPatientDetailsByUHID = useCallback(async (uhid: string) => {
    if (!uhid) return;
    try {
      const { data, error } = await supabase
        .from("patient_detail")
        .select("*")
        .eq("uhid", uhid)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
        throw error;
      }

      if (data) {
        setFormData((prev: IPDFormInput) => ({
          ...prev,
          name: data.name || "",
          phone: data.number || "",
          age: data.age || "",
          ageUnit: data.age_unit || "years",
          gender: data.gender || null,
          address: data.address || null,
        }));
        toast.success(`Patient details loaded for UHID: ${uhid}`);
      } else {
        toast.info(`No existing patient found for UHID: ${uhid}. Please fill details.`);
        // Optionally clear other patient fields if UHID doesn't match
        setFormData((prev: IPDFormInput) => ({
          ...prev,
          name: "",
          phone: "",
          age: "",
          ageUnit: "years",
          gender: null,
          address: null,
          // Keep UHID if manually typed, but clear other fields
        }));
      }
    } catch (error) {
      console.error("Error fetching patient by UHID:", error);
      toast.error("Failed to fetch patient details by UHID.");
    }
  }, []);

  useEffect(() => {
    if (formData.uhid) {
      fetchPatientDetailsByUHID(formData.uhid);
    }
  }, [formData.uhid, fetchPatientDetailsByUHID]);

  // Fill form with selected patient data (OPD-like)
  const fillFormWithPatientData = useCallback((p: PatientDetail) => {
    setFormData((prev) => ({
      ...prev,
      uhid: p.uhid || "",
      name: p.name || "",
      phone: p.number ?? "",
      age: p.age ?? "",
      ageUnit: p.age_unit || "years",
      gender: p.gender,
      address: p.address,
    }))
    setSelectedPatient(p)
    setIsEditingPatient(false)
  }, [])

  // Reset selection and form for new patient entry
  const resetForNewPatient = useCallback(() => {
    setSelectedPatient(null)
    setIsEditingPatient(false)
    setSearchedPatientResults(null)
    setSearchUhIdInput("")
    setSearchPhoneInput("")
  }, [])

  // Search by UHID (full or counter-only)
  const handleSearchByUhId = useCallback(async () => {
    if (!searchUhIdInput.trim()) {
      toast.error("Enter UHID or counter number to search.")
      return
    }
    setIsSearching(true)
    setSearchedPatientResults(null)
    try {
      const raw = searchUhIdInput.trim().toUpperCase()
      const isCounterOnly = /^\d+$/.test(raw)
      let query = supabase
        .from("patient_detail")
        .select("patient_id, name, number, age, age_unit, dob, gender, address, uhid")
      if (isCounterOnly) {
        const formattedCounter = raw.padStart(5, '0')
        query = query.ilike("uhid", `%-${formattedCounter}`)
      } else {
        query = query.eq("uhid", raw)
      }
      const { data, error } = await query
      if (error) throw error
      if (!data || (Array.isArray(data) && data.length === 0)) {
        toast.error("No patient found.")
        return
      }
      // If one result, fill directly; else show list
      if (Array.isArray(data)) {
        if (data.length === 1) {
          fillFormWithPatientData(data[0] as PatientDetail)
          toast.success("Patient loaded.")
        } else {
          setSearchedPatientResults(data as PatientDetail[])
          toast.info("Select patient from list.")
        }
      } else {
        fillFormWithPatientData(data as unknown as PatientDetail)
        toast.success("Patient loaded.")
      }
    } catch (e: any) {
      console.error(e)
      toast.error("UHID search failed.")
    } finally {
      setIsSearching(false)
    }
  }, [fillFormWithPatientData, searchUhIdInput])

  // Search by phone number
  const handleSearchByPhoneNumber = useCallback(async () => {
    if (!searchPhoneInput.trim()) {
      toast.error("Enter phone number to search.")
      return
    }
    const phoneAsNumber = Number(searchPhoneInput.trim())
    if (Number.isNaN(phoneAsNumber)) {
      toast.error("Invalid phone number.")
      return
    }
    setIsSearching(true)
    setSearchedPatientResults(null)
    try {
      const { data, error } = await supabase
        .from("patient_detail")
        .select("patient_id, name, number, age, age_unit, dob, gender, address, uhid")
        .eq("number", phoneAsNumber)
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error("No patients found with this phone number.")
        return
      }
      if (data.length === 1) {
        fillFormWithPatientData(data[0] as PatientDetail)
        toast.success("Patient loaded.")
      } else {
        setSearchedPatientResults(data as PatientDetail[])
        toast.info("Select patient from list.")
      }
    } catch (e: any) {
      console.error(e)
      toast.error("Phone search failed.")
    } finally {
      setIsSearching(false)
    }
  }, [searchPhoneInput, fillFormWithPatientData])

  // Update existing patient details explicitly
  const handleUpdatePatientDetails = useCallback(async () => {
    if (!selectedPatient) return
    setIsLoading(true)
    try {
      // Convert age to number or null; phone to number or null
      const phoneNum = formData.phone !== null && formData.phone !== '' ? Number(formData.phone) : null
      const ageNum = formData.age !== null && formData.age !== '' ? Number(formData.age) : null
      const { error } = await supabase
        .from("patient_detail")
        .update({
          name: String(formData.name).trim(),
          number: phoneNum,
          age: ageNum,
          age_unit: formData.ageUnit,
          gender: formData.gender,
          address: formData.address,
        })
        .eq("patient_id", selectedPatient.patient_id)
        .eq("uhid", selectedPatient.uhid)
      if (error) throw error
      // Update local selectedPatient and form
      const updated: PatientDetail = {
        ...selectedPatient,
        name: String(formData.name).trim(),
        number: phoneNum,
        age: ageNum,
        age_unit: formData.ageUnit,
        gender: formData.gender,
        address: formData.address,
      }
      setSelectedPatient(updated)
      toast.success("Patient details updated.")
      setIsEditingPatient(false)
    } catch (e: any) {
      console.error("Failed to update patient details:", e)
      toast.error(`Failed to update patient details: ${e.message}`)
    } finally {
      setIsLoading(false)
    }
  }, [selectedPatient, formData])

  const fetchPatients = async () => {
    try {
      const { data, error } = await supabase
        .from("patient_detail")
        .select("*")
        .order("created_at", { ascending: false })

      if (error) throw error
      setPatients(data || [])
    } catch (error) {
      console.error("Error fetching patients:", error)
    }
  }

  const fetchAllDoctors = async () => {
    try {
      const { data, error } = await supabase.from("doctor").select("*")

      if (error) throw error
      // Convert doctor IDs to number for consistency with the updated Doctor interface
      setAllDoctors(data ? data.map(doc => ({ ...doc, id: Number(doc.id) })) : [])
    } catch (error) {
      console.error("Error fetching doctors:", error)
    }
  }

  const fetchBeds = async () => {
    try {
      const { data, error } = await supabase.from("bed_management").select("*")

      if (error) {
        console.error("Supabase fetch beds error:", error)
        throw error
      }
      console.log("Fetched beds from Supabase:", data)
      // Convert bed IDs to number for consistency with the updated BedData interface
      setBeds(data ? data.map(bed => ({ ...bed, id: Number(bed.id) })) : [])
    } catch (error) {
      console.error("Error fetching beds:", error)
      toast.error("Failed to fetch beds")
    }
  }

  const handlePatientNameChange = (value: string) => {
    // Keep simple behavior: update name and clear UHID if the user edits name (new patient case)
    setFormData((prev: IPDFormInput) => ({ ...prev, name: value, uhid: "" }));
  }

  // Removed selectPatient() as name-based suggestions UI is removed

  const sendWhatsAppNotification = async (phoneNumber: string, message: string) => {
    // Basic validation to ensure phoneNumber is a string and not empty
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
      console.warn("Skipping WhatsApp notification: Phone number is missing or invalid.");
      return;
    }
    const token = "9958399157"; // Your provided token

    try {
      const response = await fetch("https://a.infispark.in/send-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: token,
          number: `91${phoneNumber}`, // Prepend 91 for Indian numbers as per your API
          message: message,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        toast.success(`WhatsApp message sent to ${phoneNumber} successfully!`);
        console.log(`WhatsApp message sent to ${phoneNumber}:`, data);
      } else {
        toast.error(`Failed to send WhatsApp message to ${phoneNumber}: ${data.message || 'Unknown error'}`);
        console.error(`Failed to send WhatsApp message to ${phoneNumber}:`, data);
      }
    } catch (error) {
      toast.error(`Error sending WhatsApp message to ${phoneNumber}.`);
      console.error(`Error sending WhatsApp message to ${phoneNumber}:`, error);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || !formData.phone || !formData.roomType || formData.bed === null) { // Check for null bed
      toast.error("Please fill all required fields (Patient Name, Phone, Room Type, Bed).")
      return
    }

    // New validation for 'through' field when paymentMode is 'online'
    if (formData.paymentMode === "online" && !formData.through) {
      toast.error("Please select a 'Through' method for online payment.");
      return;
    }


    setIsLoading(true)

    try {
      let patientUhid = formData.uhid;
      let calculatedDob: string | null = null;

      // Calculate DOB based on age and ageUnit
      if (formData.age && formData.ageUnit) {
        const today = new Date();
        let dobDate = new Date(today);

        const ageNum = Number(formData.age);

        if (formData.ageUnit === "years") {
          dobDate.setFullYear(today.getFullYear() - ageNum);
        } else if (formData.ageUnit === "months") {
          dobDate.setMonth(today.getMonth() - ageNum);
        } else if (formData.ageUnit === "days") {
          dobDate.setDate(today.getDate() - ageNum);
        }
        calculatedDob = dobDate.toISOString().split('T')[0]; // Format to YYYY-MM-DD
      }

      // Check if patient exists by UHID or name/phone if UHID is empty
      let existingPatient: PatientDetail | null = null;
      if (patientUhid) {
        const { data: existing, error: existingError } = await supabase
          .from("patient_detail")
          .select("*")
          .eq("uhid", patientUhid)
          .single();
        if (existingError && existingError.code !== 'PGRST116') throw existingError;
        existingPatient = existing;
      } else if (formData.name && formData.phone) {
        // If no UHID, check by name and phone for potential existing patient
        const { data: existing, error: existingError } = await supabase
          .from("patient_detail")
          .select("*")
          .eq("name", formData.name)
          .eq("number", Number(formData.phone))
          .single();
        if (existingError && existingError.code !== 'PGRST116') throw existingError;
        existingPatient = existing;
      }


      if (existingPatient) {
        patientUhid = existingPatient.uhid; // Ensure UHID is set from existing patient
        // Update existing patient details
        const { error: patientUpdateError } = await supabase
          .from("patient_detail")
          .update({
            name: formData.name,
            number: formData.phone ? Number(formData.phone) : null,
            age: formData.age ? Number(formData.age) : null,
            age_unit: formData.ageUnit,
            gender: formData.gender,
            address: formData.address,
            dob: calculatedDob, // Update calculated DOB
            updated_at: new Date().toISOString(),
          })
          .eq("uhid", patientUhid);
        if (patientUpdateError) throw patientUpdateError;
        toast.success(`Existing patient (UHID: ${patientUhid}) details updated.`);
      } else {
        // Generate new UHID for a truly new patient
        const uhidResult = await generateNextUHID();
        if (!uhidResult.success || !uhidResult.uhid) {
          throw new Error(uhidResult.message || "Failed to generate UHID.");
        }
        patientUhid = uhidResult.uhid;

        // Insert new patient
        const { data: newPatientData, error: patientInsertError } = await supabase
          .from("patient_detail")
          .insert({
            name: formData.name,
            number: formData.phone ? Number(formData.phone) : null,
            age: formData.age ? Number(formData.age) : null,
            age_unit: formData.ageUnit,
            gender: formData.gender,
            address: formData.address,
            uhid: patientUhid,
            dob: calculatedDob,
          })
          .select()
          .single();
        if (patientInsertError) throw patientInsertError;
        toast.success(`New patient registered with UHID: ${patientUhid}`);
      }

      // Create payment detail conditionally
      const paymentDetail: PaymentDetailItem[] = [];
      const depositAmount = formData.depositAmount ? Number.parseFloat(String(formData.depositAmount)) : 0;

      if (depositAmount > 0) {
        paymentDetail.push({
          date: new Date().toISOString(),
          type: "deposit", // This 'type' field is from the old structure, keeping for compatibility
          amount: depositAmount,
          createdAt: new Date().toISOString(),
          paymentType: formData.paymentMode,
          through: formData.through || "cash", // Ensure through always has a value
          amountType: "deposit", // Set amountType to 'deposit' by default for new appointments
        });
      }

      // Service detail will be an empty array by default as per request
      const serviceDetail: ServiceDetailItem[] = [];

      // Bed ID is already a number from formData.bed due to type change
      const selectedBedIdForDb = formData.bed;
      if (selectedBedIdForDb === null) {
        throw new Error("Invalid bed selection. This should not happen due to validation.");
      }

      // Get the doctor's name to store, not the ID
      const doctorNameForDB = getDoctorNameById(formData.underCareOfDoctor);

      // Insert new IPD registration
      const { data: ipdData, error: ipdError } = await supabase
        .from("ipd_registration")
        .insert({
          uhid: patientUhid, // Link using UHID
          admission_source: formData.admissionSource,
          admission_type: formData.admissionType,
          under_care_of_doctor: doctorNameForDB, // Storing doctor's name
          payment_detail: paymentDetail, // Now includes 'through' and 'amountType'
          bed_id: selectedBedIdForDb, // This is now correctly a number
          service_detail: serviceDetail, // Empty by default
          relative_name: formData.relativeName,
          relative_ph_no: formData.relativePhone ? Number(formData.relativePhone) : null,
          relative_address: formData.relativeAddress,
          admission_date: formData.date,
          admission_time: formData.time,
          mrd: formData.mrd || null,
          tpa: formData.tpa || false, // Save tpa
        })
        .select()

      if (ipdError) throw ipdError
      toast.success("IPD admission registered successfully!")

      // Update bed status to occupied
      const { error: bedError } = await supabase
        .from("bed_management")
        .update({ status: "occupied" })
        .eq("id", selectedBedIdForDb) // This is now correctly a number

      if (bedError) throw bedError

      // --- WhatsApp Notification Logic ---
      const selectedBed = beds.find(bed => bed.id === selectedBedIdForDb);

      // Patient message
      if (formData.phone) {
        const patientMessage = `
🏥 *IPD Admission Confirmation - Medford Hospital*

Dear *${formData.name}*,

Your IPD admission has been successfully registered.

*Details:*
•   *UHID:* ${patientUhid}
•   *Admission Date:* ${formData.date}
•   *Admission Time:* ${formData.time}
•   *Room Type:* ${roomTypeOptions.find(opt => opt.value === formData.roomType)?.label || 'N/A'}
•   *Bed Number:* ${selectedBed?.bed_number || 'N/A'} (${selectedBed?.bed_type || 'N/A'})
•   *Under Care Of:* Dr. ${doctorNameForDB}

We wish you a speedy recovery!

For any assistance, please contact us.
Medford Hospital
`;
        await sendWhatsAppNotification(String(formData.phone), patientMessage); // Ensure phone is string
      }

      // Relative message
      if (formData.relativeName && formData.relativePhone) {
        const relativeMessage = `
🏥 *IPD Admission Update - Medford Hospital*

Dear ${formData.relativeName},

This message is to confirm the IPD admission of *${formData.name}*.

*Patient Details:*
•   *Name:* ${formData.name}
•   *UHID:* ${patientUhid}

*Admission Details:*
•   *Date:* ${formData.date}
•   *Time:* ${formData.time}
•   *Room Type:* ${roomTypeOptions.find(opt => opt.value === formData.roomType)?.label || 'N/A'}
•   *Bed Number:* ${selectedBed?.bed_number || 'N/A'} (${selectedBed?.bed_type || 'N/A'})
•   *Under Care Of:* Dr. ${doctorNameForDB}

We will keep you updated on their progress.

For any queries, please feel free to reach out.
Medford Hospital
`;
        await sendWhatsAppNotification(String(formData.relativePhone), relativeMessage); // Ensure relativePhone is string
      }
      // --- End WhatsApp Notification Logic ---

      resetForm()
      fetchBeds() // Refresh bed data
    } catch (error) {
      console.error("Error submitting admission:", error)
      toast.error("Failed to register/update admission: " + (error as any).message)
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      uhid: "",
      name: "",
      phone: "",
      age: "",
      ageUnit: "years",
      gender: null,
      address: null,
      relativeName: "",
      relativePhone: "",
      relativeAddress: null,
      admissionSource: "ipd",
      admissionType: "general",
      referralDoctor: "",
      underCareOfDoctor: "", // Reset to empty string for name
      depositAmount: "",
      paymentMode: "cash",
      through: "cash", // Reset 'through' to cash default
      roomType: "",
      bed: null,
      date: new Date().toISOString().split("T")[0],
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), // Reset to current time
      tpa: false, // Reset tpa to false
    })
  }

  const handlePreview = () => {
    if (!formData.name || !formData.phone) {
      toast.error("Please fill patient information first")
      return
    }
    // Perform validation for 'through' field before showing preview
    if (formData.paymentMode === "online" && !formData.through) {
      toast.error("Please select a 'Through' method for online payment before previewing.");
      return;
    }
    setShowPreview(true)
  }

  const handleConfirmSubmit = () => {
    setShowPreview(false)
    const form = document.getElementById("ipd-form") as HTMLFormElement
    if (form) {
      form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }))
    }
  }

  const handleBedSelectFromPopup = (bedId: number) => { // bedId is number now
    const selectedBed = beds.find((bed) => bed.id === bedId)
    if (selectedBed) {
      setFormData((prev: IPDFormInput) => ({
        ...prev,
        roomType: selectedBed.room_type,
        bed: selectedBed.id, // bed.id is number
      }))
      setShowAvailability(false)
    }
  }

  // Group beds by room type for the availability popup
  const groupBedsByRoomType = () => {
    const groupedBeds: Record<string, BedData[]> = {}

    beds.forEach((bed) => {
      if (!groupedBeds[bed.room_type]) {
        groupedBeds[bed.room_type] = []
      }
      groupedBeds[bed.room_type].push(bed)
    })

    return groupedBeds
  }

  const groupedBeds = groupBedsByRoomType()

  // FIX: Use doctor.dr_name as the value and label
  const filteredDoctorOptions = useMemo(() => {
    return allDoctors.map((doctor) => ({
      value: doctor.dr_name, // Use doctor.dr_name as the value
      label: doctor.dr_name,    // Use doctor.dr_name for display
    }));
  }, [allDoctors]);

  const bedSelectOptions = useMemo(() => {
    const options = availableBeds.map((bed) => ({
      value: String(bed.id), // Convert to string for <SearchableSelect> value
      label: `Bed ${bed.bed_number} - ${bed.bed_type}`,
    }))

    // Ensure the currently selected bed is always an option, even if it's no longer 'available'
    if (formData.bed !== null && !options.some((opt) => Number(opt.value) === formData.bed)) { // Compare with number
      const selectedBed = beds.find((bed) => bed.id === formData.bed)
      if (selectedBed) {
        options.unshift({
          value: String(selectedBed.id), // Convert to string for <SearchableSelect> value
          label: `Bed ${selectedBed.bed_number} - ${selectedBed.bed_type} (Selected)`,
        })
      }
    }
    return options
  }, [availableBeds, formData.bed, beds])

  // Helper to get doctor name by ID for display in preview and PDF
  const getDoctorNameById = useCallback((doctorId: string | number | null) => {
    // If underCareOfDoctor already contains the name (as per new logic), return it directly
    if (typeof doctorId === 'string' && allDoctors.some(doc => doc.dr_name === doctorId)) {
      return doctorId;
    }
    // Otherwise, if it's an ID (from old state or if select returns ID), find the name
    const doctor = allDoctors.find(doc => String(doc.id) === String(doctorId));
    return doctor ? doctor.dr_name : "N/A";
  }, [allDoctors]);


  return (
    <Layout>
      <div className="space-y-8">
        {/* Search Existing Patient (OPD-like) */}
        <Card className="shadow-md rounded-lg border-none">
          <CardHeader className="bg-blue-50 border-b border-blue-200 py-4">
            <CardTitle className="flex items-center gap-3 text-lg text-blue-800">
              Search Existing Patient
              {selectedPatient && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetForNewPatient}
                  className="ml-auto text-red-600 hover:text-red-700 flex items-center gap-1"
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
                  <Button onClick={handleSearchByUhId} disabled={isSearching || !!selectedPatient} className="min-w-[100px]">
                    {isSearching ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="search-phone">Search by Phone</Label>
                <div className="flex gap-2">
                  <Input
                    id="search-phone"
                    placeholder="Enter 10-digit phone number"
                    value={searchPhoneInput}
                    onChange={(e) => setSearchPhoneInput(e.target.value)}
                    disabled={isSearching || !!selectedPatient}
                    className="h-10"
                  />
                  <Button onClick={handleSearchByPhoneNumber} disabled={isSearching || !!selectedPatient} className="min-w-[100px]">
                    {isSearching ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>
            </div>

            {searchedPatientResults && (
              <div className="space-y-2">
                <Label>Select Patient from Results</Label>
                <SearchableSelect
                  options={searchedPatientResults.map((p) => ({ value: p.uhid, label: `${p.name} (${p.uhid}) – ${p.number ?? ''}` }))}
                  value={""}
                  onValueChange={(v) => {
                    const sel = searchedPatientResults.find((p) => p.uhid === v)
                    if (sel) {
                      fillFormWithPatientData(sel)
                      toast.success(`Selected: ${sel.name}`)
                    }
                  }}
                  placeholder="Choose patient"
                />
              </div>
            )}

            {selectedPatient && (
              <div className="bg-blue-100 p-4 rounded-lg flex items-center justify-between text-base text-blue-900 border border-blue-200">
                <span>
                  Selected Patient: <span className="font-semibold">{selectedPatient.name}</span> (UHID: <span className="font-mono font-bold">{selectedPatient.uhid}</span>)
                </span>
                <div className="flex gap-2">
                  {!isEditingPatient ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsEditingPatient(true)} className="text-blue-600 border-blue-500 hover:bg-blue-50">
                      Edit Details
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => setIsEditingPatient(false)} className="text-gray-600 border-gray-500 hover:bg-gray-50">
                        Cancel
                      </Button>
                      <Button type="button" size="sm" onClick={handleUpdatePatientDetails} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
                        {isLoading ? "Updating..." : "Update Details"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        {/* Header */}
        <div className="text-center bg-gradient-to-r from-blue-600 to-purple-600 text-white py-8 rounded-lg shadow-md">
          <h1 className="text-4xl font-bold mb-3">IPD Admission</h1>
          <p className="text-lg opacity-90">Register new IPD patient admission</p>
        </div>

        <form id="ipd-form" onSubmit={handleSubmit} className="space-y-6">
          {/* Patient Information */}
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-blue-800">
                <User className="h-5 w-5" />
                <span>Patient Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Patient Name</Label>
                  <Input
                    id="name"
                    placeholder="Enter patient name"
                    value={formData.name}
                    onChange={(e) => handlePatientNameChange(e.target.value)}
                    required
                    autoComplete="off"
                    className="placeholder-gray-400"
                    disabled={selectedPatient ? !isEditingPatient : false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    placeholder="Enter phone number"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, phone: e.target.value }))}
                    required
                    autoComplete="off"
                    className="placeholder-gray-400"
                    disabled={selectedPatient ? !isEditingPatient : false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uhid">UHID</Label>
                  <Input
                    id="uhid"
                    placeholder={formData.uhid ? "Auto-populated" : "Auto-generated on submit"}
                    value={formData.uhid}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, uhid: e.target.value }))}
                    onBlur={(e) => fetchPatientDetailsByUHID(e.target.value)} // Fetch details on blur
                    autoComplete="off"
                    className={`placeholder-gray-400 ${formData.uhid ? "bg-gray-100 cursor-not-allowed" : ""}`}
                    disabled={!!selectedPatient}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age">Age</Label>
                  <Input
                    id="age"
                    type="number"
                    placeholder="Enter age"
                    value={formData.age || ''}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, age: e.target.value }))}
                    className="placeholder-gray-400"
                    disabled={selectedPatient ? !isEditingPatient : false}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Age Unit</Label>
                  <SearchableSelect
                    options={ageUnitOptions}
                    value={formData.ageUnit}
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, ageUnit: value }))}
                    placeholder="Select age unit"
                    disabled={selectedPatient ? !isEditingPatient : false}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Gender</Label>
                  <SearchableSelect
                    options={genderOptions}
                    value={formData.gender || ''} // Handle null for UI
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, gender: value }))}
                    placeholder="Select gender"
                    disabled={selectedPatient ? !isEditingPatient : false}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  placeholder="Enter patient address"
                  value={formData.address || ''} // Handle null for UI
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, address: e.target.value }))}
                    autoComplete="off"
                    className="placeholder-gray-400"
                    disabled={selectedPatient ? !isEditingPatient : false}
                />
              </div>
            </CardContent>
          </Card>

          {/* Relative Information */}
          <Card className="bg-green-50 border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-green-800">
                <Phone className="h-5 w-5" />
                <span>Relative Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="relativeName">Relative Name</Label>
                  <Input
                    id="relativeName"
                    placeholder="Enter relative name"
                    value={formData.relativeName}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, relativeName: e.target.value }))}
                    className="placeholder-gray-400"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relativePhone">Relative Phone No.</Label>
                  <Input
                    id="relativePhone"
                    placeholder="Enter relative phone"
                    value={formData.relativePhone || ''}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, relativePhone: e.target.value }))}
                    className="placeholder-gray-400"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relativeAddress">Relative Address</Label>
                  <Input
                    id="relativeAddress"
                    placeholder="Enter relative address"
                    value={formData.relativeAddress || ''} // Handle null for UI
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, relativeAddress: e.target.value }))}
                    autoComplete="off"
                    className="placeholder-gray-400"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Admission Details */}
          <Card className="bg-purple-50 border-purple-200">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-purple-800">
                <Calendar className="h-5 w-5" />
                <span>Admission Details</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Admission Source</Label>
                  <SearchableSelect
                    options={admissionSourceOptions}
                    value={formData.admissionSource}
                    onValueChange={(value) =>
                      setFormData((prev: IPDFormInput) => ({ ...prev, admissionSource: value, referralDoctor: "" })) // Clear referral doctor if not 'referral'
                    }
                    placeholder="Select admission source"
                  />
                </div>

                {formData.admissionSource === "referral" && (
                  <div className="space-y-2">
                    <Label htmlFor="referralDoctor">Referral Doctor</Label>
                    <Input
                      id="referralDoctor"
                      placeholder="Enter referral doctor name"
                      value={formData.referralDoctor}
                      onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, referralDoctor: e.target.value }))}
                      className="placeholder-gray-400"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="mrd">MRD Number (Optional)</Label>
                  <Input
                    id="mrd"
                    placeholder="Enter MRD number"
                    value={formData.mrd || ''}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, mrd: e.target.value }))}
                    className="placeholder-gray-400"
                  />
                </div>

                <div className="space-y-2">
                  <Label>TPA (Third Party Administrator)</Label>
                  <SearchableSelect
                    options={[
                      { value: "true", label: "Yes" },
                      { value: "false", label: "No" },
                    ]}
                    value={String(formData.tpa)}
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, tpa: value === "true" }))}
                    placeholder="Select TPA option"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Admission Type</Label>
                  <SearchableSelect
                    options={admissionTypeOptions}
                    value={formData.admissionType}
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, admissionType: value }))}
                    placeholder="Select admission type"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Under Care of Doctor</Label>
                  <SearchableSelect
                    options={filteredDoctorOptions}
                    value={formData.underCareOfDoctor} // This now stores the doctor's name
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, underCareOfDoctor: value }))}
                    placeholder="Select doctor"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="depositAmount">Deposit Amount</Label>
                  <Input
                    id="depositAmount"
                    type="number"
                    placeholder="Enter deposit amount"
                    value={formData.depositAmount || ''}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, depositAmount: e.target.value }))}
                    className="placeholder-gray-400"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Payment Mode</Label>
                  <SearchableSelect
                    options={paymentModeOptions}
                    value={formData.paymentMode}
                    onValueChange={(value) => {
                      setFormData((prev: IPDFormInput) => ({ ...prev, paymentMode: value }));
                    }}
                    placeholder="Select payment mode"
                  />
                </div>

                {/* New "Through" dropdown, conditional on paymentMode */}
                {formData.paymentMode === "online" && (
                  <div className="space-y-2">
                    <Label>Through</Label>
                    <SearchableSelect
                      options={onlineThroughOptions}
                      value={formData.through || ''} // Handle null for UI
                      onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, through: value }))}
                      placeholder="Select method"
                    />
                  </div>
                )}

                {/* "Through" dropdown for cash, always "Cash" and disabled */}
                {formData.paymentMode === "cash" && (
                  <div className="space-y-2">
                    <Label>Through</Label>
                    <SearchableSelect
                      options={cashThroughOptions}
                      value={formData.through || 'cash'} // Always show 'cash'
                      onValueChange={() => {}} // No-op as it's disabled
                      placeholder="Cash"
                      disabled // Disable the dropdown
                    />
                  </div>
                )}


                <div className="space-y-2">
                  <Label htmlFor="date">Admission Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, date: e.target.value }))}
                    className="placeholder-gray-400"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="time">Admission Time</Label>
                  <Input
                    id="time"
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData((prev: IPDFormInput) => ({ ...prev, time: e.target.value }))}
                    className="placeholder-gray-400"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Room & Bed Assignment */}
          <Card className="bg-orange-50 border-orange-200">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-orange-800">
                <Bed className="h-5 w-5" />
                <span>Room & Bed Assignment</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {" "}
                {/* Added items-start */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Room Type</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAvailability(true)}
                      className="text-xs"
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      View Availability
                    </Button>
                  </div>
                  <SearchableSelect
                    options={roomTypeOptions}
                    value={formData.roomType}
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, roomType: value, bed: null }))} // Set bed to null when room type changes
                    placeholder="Select room type"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bed</Label>
                  <SearchableSelect
                    options={bedSelectOptions}
                    value={formData.bed !== null ? String(formData.bed) : ''} // Convert to string for display
                    onValueChange={(value) => setFormData((prev: IPDFormInput) => ({ ...prev, bed: Number(value) }))} // Convert back to number
                    placeholder={!formData.roomType || availableBeds.length === 0 ? "No Beds Available" : "Select bed"}
                    disabled={!formData.roomType || availableBeds.length === 0}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-center space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreview}
              className="border-blue-600 text-blue-600 hover:bg-blue-50 bg-transparent"
            >
              <Eye className="h-4 w-4 mr-2" />
              Preview
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700">
              {isLoading ? "Submitting..." : "Submit Admission"}
            </Button>
          </div>
        </form>

        {/* Bed Availability Popup */}
        {showAvailability && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-4xl max-h-[80vh] overflow-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-blue-700 flex items-center">
                  <Bed className="h-5 w-5 mr-2" />
                  Bed Availability
                </h2>
                <button onClick={() => setShowAvailability(false)} className="text-gray-500 hover:text-gray-700">
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              {beds.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <AlertCircle className="h-12 w-12 text-gray-400 mb-2" />
                  <p className="text-gray-500">No bed data available</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {roomTypeOptions.map((roomTypeOption) => {
                    const roomBeds = groupedBeds[roomTypeOption.value] || []
                    const availableBedsCount = roomBeds.filter((bed) => bed.status === "available").length
                    const totalBedsCount = roomBeds.length

                    return (
                      <div key={roomTypeOption.value} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 p-4 border-b">
                          <div className="flex justify-between items-center">
                            <h3 className="text-lg font-semibold capitalize">{roomTypeOption.label}</h3>
                            <span
                              className={`px-3 py-1 rounded-full text-sm ${
                                availableBedsCount > 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                              }`}
                            >
                              {availableBedsCount} of {totalBedsCount} available
                            </span>
                          </div>
                        </div>

                        <div className="p-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                            {roomBeds.map((bed) => {
                              const isAvailable = bed.status === "available"
                              // Explicitly type the status mapping object
                              const statusColorMap: Record<BedData['status'], string> = {
                                available: "bg-green-100 text-green-800",
                                occupied: "bg-red-100 text-red-800",
                                maintenance: "bg-yellow-100 text-yellow-800",
                                reserved: "bg-blue-100 text-blue-800",
                              };
                              const statusColor = statusColorMap[bed.status] || "bg-gray-100 text-gray-800";

                              return (
                                <div
                                  key={bed.id}
                                  className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                    isAvailable
                                      ? "border-green-500 bg-green-50 hover:bg-green-100"
                                      : "border-gray-300 bg-gray-50 opacity-80"
                                  }`}
                                  onClick={() => isAvailable && handleBedSelectFromPopup(bed.id)}
                                >
                                  <Bed size={24} className={isAvailable ? "text-green-600" : "text-gray-500"} />
                                  <span className="text-sm mt-1 font-medium">Bed {bed.bed_number}</span>
                                  <span className={`text-xs px-2 py-1 rounded-full mt-1 ${statusColor}`}>
                                    {bed.status}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Preview Dialog */}
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-blue-700">Admission Preview</DialogTitle>
              <DialogDescription className="text-gray-600">
                Review the admission details before submitting
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-lg text-blue-800 mb-3 flex items-center">
                  <User className="h-5 w-5 mr-2" />
                  Patient Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Name:</span>
                    <p className="font-semibold mt-1">{formData.name}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Phone:</span>
                    <p className="font-semibold mt-1">{formData.phone}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">UHID:</span>
                    <p className="font-semibold mt-1">{formData.uhid || "Not yet generated"}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Age:</span>
                    <p className="font-semibold mt-1">{formData.age} {formData.ageUnit}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Gender:</span>
                    <p className="font-semibold mt-1">{formData.gender}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm col-span-2">
                    <span className="font-medium text-gray-500">Address:</span>
                    <p className="font-semibold mt-1">{formData.address}</p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="font-semibold text-lg text-green-800 mb-3 flex items-center">
                  <Phone className="h-5 w-5 mr-2" />
                  Relative Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Name:</span>
                    <p className="font-semibold mt-1">{formData.relativeName}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Phone:</span>
                    <p className="font-semibold mt-1">{formData.relativePhone}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm col-span-2">
                    <span className="font-medium text-gray-500">Address:</span>
                    <p className="font-semibold mt-1">{formData.relativeAddress}</p>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 p-4 rounded-lg">
                <h3 className="font-semibold text-lg text-purple-800 mb-3 flex items-center">
                  <Calendar className="h-5 w-5 mr-2" />
                  Admission Details
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Source:</span>
                    <p className="font-semibold mt-1">
                      {admissionSourceOptions.find((s) => s.value === formData.admissionSource)?.label}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Type:</span>
                    <p className="font-semibold mt-1">
                      {admissionTypeOptions.find((t) => t.value === formData.admissionType)?.label}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Doctor:</span>
                    <p className="font-semibold mt-1">{formData.underCareOfDoctor}</p> {/* Displaying doctor name directly */}
                  </div>
                  {/* Display deposit amount only if greater than 0 */}
                  {Number(formData.depositAmount) > 0 && (
                    <div className="bg-white p-3 rounded-md shadow-sm">
                      <span className="font-medium text-gray-500">Deposit:</span>
                      <p className="font-semibold mt-1">₹{formData.depositAmount}</p>
                    </div>
                  )}
                  {/* Display payment mode only if deposit amount is greater than 0 */}
                  {Number(formData.depositAmount) > 0 && (
                    <div className="bg-white p-3 rounded-md shadow-sm">
                      <span className="font-medium text-gray-500">Payment:</span>
                      <p className="font-semibold mt-1">
                        {paymentModeOptions.find((p) => p.value === formData.paymentMode)?.label}
                      </p>
                    </div>
                  )}
                   {/* Display 'Through' only if a method is selected */}
                   {formData.through && (
                    <div className="bg-white p-3 rounded-md shadow-sm">
                      <span className="font-medium text-gray-500">Through:</span>
                      <p className="font-semibold mt-1">
                        {(formData.paymentMode === 'cash' ? cashThroughOptions : onlineThroughOptions).find((opt) => opt.value === formData.through)?.label || formData.through}
                      </p>
                    </div>
                  )}
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Date:</span>
                    <p className="font-semibold mt-1">{formData.date}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Time:</span>
                    <p className="font-semibold mt-1">{formData.time}</p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Room:</span>
                    <p className="font-semibold mt-1">
                      {roomTypeOptions.find((r) => r.value === formData.roomType)?.label}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-md shadow-sm">
                    <span className="font-medium text-gray-500">Bed:</span>
                    <p className="font-semibold mt-1">
                      {beds.find((b) => b.id === formData.bed)?.bed_number} -{" "}
                      {beds.find((b) => b.id === formData.bed)?.bed_type}
                    </p>
                  </div>
                  {formData.mrd && (
                    <div className="bg-white p-3 rounded-md shadow-sm">
                      <span className="font-medium text-gray-500">MRD Number:</span>
                      <p className="font-semibold mt-1">{formData.mrd}</p>
                    </div>
                  )}
                  {formData.tpa !== undefined && (
                    <div className="bg-white p-3 rounded-md shadow-sm">
                      <span className="font-medium text-gray-500">TPA (Third Party Administrator):</span>
                      <p className="font-semibold mt-1">{formData.tpa ? "Yes" : "No"}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Cancel
              </Button>
              <IPDSignaturePDF
                data={{
                  uhid: formData.uhid,
                  name: formData.name,
                  phone: String(formData.phone), // Ensure string for PDF
                  age: Number(formData.age), // Ensure number for PDF
                  ageUnit: formData.ageUnit,
                  gender: String(formData.gender), // Ensure string for PDF
                  address: String(formData.address), // Ensure string for PDF
                  relativeName: formData.relativeName,
                  relativePhone: formData.relativePhone,
                  relativeAddress: formData.relativeAddress,
                  admissionSource: formData.admissionSource,
                  admissionType: formData.admissionType,
                  referralDoctor: formData.referralDoctor,
                  underCareOfDoctor: formData.underCareOfDoctor, // Pass name for PDF
                  depositAmount: formData.depositAmount,
                  paymentMode: formData.paymentMode,
                  bed: formData.bed !== null ? formData.bed : 0, // Ensure number for PDF, handle null case if possible (0 might not be valid bed)
                  roomType: formData.roomType,
                  date: formData.date,
                  time: formData.time,
                  paymentDetails: Number(formData.depositAmount) > 0 ? [{
                    date: new Date().toISOString(),
                    type: "deposit",
                    amount: Number(formData.depositAmount),
                    createdAt: new Date().toISOString(),
                    paymentType: formData.paymentMode,
                    through: formData.through || "cash", // Ensure through always has a value
                    amountType: "deposit", // Set amountType to 'deposit' by default for new appointments
                  }] : null,
                  serviceDetails: null, // As per your logic, this is null by default
                  mrd: formData.mrd || null,
                  tpa: formData.tpa || false, // Pass tpa to PDF
                }}
                genderOptions={genderOptions}
                admissionSourceOptions={admissionSourceOptions}
                admissionTypeOptions={admissionTypeOptions}
                paymentModeOptions={paymentModeOptions}
                roomTypeOptions={roomTypeOptions}
                doctors={allDoctors}
                beds={beds}
              />
              <Button onClick={handleConfirmSubmit} className="bg-green-600 hover:bg-green-700">
                Confirm & Submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}

export default IPDAppointmentPage
