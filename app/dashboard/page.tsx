"use client"

import type React from "react"
import { useEffect, useState, useMemo, useCallback } from "react"
import { supabase } from "@/lib/supabase" // Using Supabase client
import {
  format,
  differenceInDays,
  addDays,
  startOfDay,
  endOfDay,
  parseISO, // For parsing ISO date strings from DB or date inputs
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
} from "date-fns"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// NO date-fns-tz IMPORTS HERE - we'll do manual offset (or in this case, remove it)

import {
  Search,
  Activity,
  DollarSign,
  Layers,
  Stethoscope,
  Filter,
  RefreshCw,
  CalendarDays,
  Clock,
  User, // Keep User icon for general use
  FileText,
  CreditCard,
  UserCheck,
  Heart,
  X,
  CalendarIcon,
} from "lucide-react"

// Shadcn/ui components
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import Layout from "@/components/global/Layout" // Your global layout component

// Register Chart.js components
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js"
import { Bar } from "react-chartjs-2" // Correctly import the Bar component
import { toast } from "sonner"
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

// ----- Type Definitions (Adapted for Supabase structure and fixes) -----

// Doctor info (fetched separately)
interface Doctor {
  id: string // Assuming doctor ID is a string/UUID, or number if you changed it
  dr_name: string // Changed from 'name' to 'dr_name' to match DB
  opd_charge?: number
  department?: string
  specialist?: string
}

// Modality/Service info (from OPD service_info JSONB)
interface IModality {
  charges: number
  doctor?: string // This will now store doctor name if available, not ID
  specialist?: string
  type: "consultation" | "casualty" | "xray" | "pathology" | "ipd" | "radiology" | "custom"
  visitType?: string
  service?: string
}

// Payment info (from OPD payment_info JSONB)
interface IPayment {
  cashAmount: number
  createdAt: string
  discount: number
  onlineAmount: number
  paymentMethod: string
  totalCharges: number
  totalPaid: number
}

// Patient detail structure as it would appear in the patient_detail table
interface PatientDetailFromSupabase {
  uhid: string
  name: string | null // Allowed to be null
  number: string | null // Assuming it can be null in DB
  age: number | null
  gender: string | null
  address: string | null
}

// OPD Registration (from Supabase `opd_registration` table)
interface OPDRegistrationSupabase {
  opd_id: string // bigint in DB, but often handled as string in JS for UUIDs or large numbers
  created_at: string // timestamp with time zone (ISO string)
  patient_id: number | null // bigint null in DB. Ensure this matches.
  date: string // date (YYYY-MM-DD string as in your INSERT), OR timestamp (ISO string)
  refer_by: string | null
  "additional Notes": string | null // Exact column name from DB
  service_info: IModality[] | null // JSONB
  payment_info: IPayment | null // JSONB
  bill_no: number // smallint in DB, use number
  uhid: string // text, foreign key to patient_detail.uhid
  // This is re-added because fetchAllAppointmentsForPatient explicitly joins it
  patient_detail?: PatientDetailFromSupabase[] | null
  "appointment_type"?: string | null
  "visit_type"?: string | null
}

// IPD Service (from IPD `service_detail` JSONB)
interface IPDService {
  amount: number
  serviceName: string
  type: string
  doctorName?: string
  createdAt: string // ISO string
}

// IPD Payment (from IPD `payment_detail` JSONB)
interface IPDPayment {
  id?: string // UUID from DB or generated, optional
  amount: number
  paymentType: "cash" | "online" | "bill_reduction" | string // Added string for flexibility
  type: "advance" | "refund" | "deposit" | "settlement" | string // Added settlement and string
  date: string // ISO string
  createdAt: string // ISO string
  through?: string // Added 'through' for online/cash payments
  transactionType?: string; // Added based on your example
  amountType?: string; // Added based on your example
}

// IPD Registration (from Supabase `ipd_registration` table)
interface IPDRegistrationSupabase {
  ipd_id: number
  uhid: string
  admission_date: string // date (YYYY-MM-DD string as in your INSERT)
  admission_time: string | null // time (HH:mm string as in your INSERT)
  under_care_of_doctor: string | null // Now storing doctor's name (string)
  payment_detail: IPDPayment[] | null // JSONB
  service_detail: IPDService[] | null // JSONB
  created_at: string // timestamp with time zone (ISO string)
  bed_id: number | null
  // These are re-added because fetchAllAppointmentsForPatient explicitly joins them
  bed_management?: { room_type: string }[] | null
  patient_detail?: PatientDetailFromSupabase[] | null
  ipd_notes?: string | null;
  tpa?: boolean; // New field for TPA status
}

// OT Details (from Supabase `ot_details` table)
interface OTDetailsSupabase {
  id: string // UUID of the OT record
  ipd_id: number | null // bigint null in schema
  uhid: string
  ot_type: "Major" | "Minor"
  ot_notes: string | null
  ot_date: string // timestamp with time zone (ISO string)
  created_at: string // timestamp with time zone (ISO string)
  // This is re-added because fetchAllAppointmentsForPatient explicitly joins it
  patient_detail?: PatientDetailFromSupabase[] | null
  has_baby_birth: boolean | null; // New field
  baby_birth_date: string | null; // New field
  baby_birth_weight: number | null; // New field
  baby_birth_gender: "Male" | "Female" | "Other" | null; // New field
  location_type?: string; // New field to differentiate OT vs Labour Room
}

// Combined types for display in tables/modals
interface OPDAppointmentDisplay {
  type: "OPD"
  id: string // Common ID for display, derived from opd_id (string)
  patientId: string // UHID
  name: string
  phone: string
  date: string // YYYY-MM-DD (directly from DB or formatted)
  time: string // HH:mm (directly from DB or formatted)
  modalities: IModality[]
  payment: IPayment
  message: string // For display, maps from additional_notes
  opd_id: string
  created_at: string // original ISO string from DB
  refer_by: string | null
  additional_notes: string | null // The correct column name from DB
  service_info: IModality[] | null
  payment_info: IPayment | null
  bill_no: number // Corrected to number
  patient_uhid_from_opd_table: string // The UHID directly from opd_registration table
  appointment_type?: string | null // Made optional if not always present
  visit_type?: string | null // Made optional if not always present
}

interface IPDAppointmentDisplay {
  type: "IPD"
  id: string // Common ID for display, derived from ipd_id
  patientId: string // UHID
  name: string
  phone: string
  totalAmount: number // Calculated gross service amount
  totalDeposit: number // Calculated net deposit (advances + deposits + settlements)
  totalRefunds: number // Calculated total refunds
  discount: number // Calculated discount
  remainingAmount: number // Calculated remaining amount
  roomType: string // From bed_management join
  ipd_id: number
  uhid: string
  admission_date: string // YYYY-MM-DD (directly from DB)
  admission_time: string | null // HH:mm (directly from DB)
  under_care_of_doctor: string | null // Now storing doctor name
  payment_detail: IPDPayment[] | null
  service_detail: IPDService[] | null
  created_at: string // original ISO string from DB
  bed_id: number | null
  ipd_notes?: string | null;
  tpa?: boolean; // New field for TPA status
}

interface OTAppointmentDisplay {
  type: "OT"
  id: string // Common ID for display, derived from id
  patientId: string // UHID
  name: string
  phone: string
  date: string // YYYY-MM-DD (directly from ot_date)
  time: string // HH:mm (derived from created_at or ot_date, directly from DB)
  message: string // For display, maps from ot_notes
  ipd_id: number | null // bigint null
  uhid: string
  ot_type: "Major" | "Minor"
  ot_notes: string | null
  ot_date: string // original ISO string from DB
  created_at: string // original ISO string from DB
  has_baby_birth: boolean | null; // New field
  baby_birth_date: string | null; // New field
  baby_birth_weight: number | null; // New field
  baby_birth_gender: "Male" | "Female" | "Other" | null; // New field
  location_type?: string; // New field for OT location type
}

type CombinedAppointment = OPDAppointmentDisplay | IPDAppointmentDisplay | OTAppointmentDisplay

// Patient Info for search results
interface PatientInfo {
  uhid: string
  name: string
  phone: string
  age: number | null
  address: string | null
  gender: string | null
}

interface FilterState {
  searchQuery: string
  filterType: "week" | "today" | "month" | "dateRange"
  selectedMonth: string
  startDate: string
  endDate: string
  showOnlyOpd: boolean; // New filter
  showOnlyIpd: boolean; // New filter
  showOnlyOt: boolean; // New filter
  showOnlyBabyBirth: boolean; // New filter
}

// ----- Helper Functions (NO CLIENT-SIDE TIMEZONE CONVERSION FOR DISPLAY) -----

// Formats a number as Indian Rupee currency
const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount)

// Formats bytes into human-readable units
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Helper to get start and end of a day for Supabase query based on a YYYY-MM-DD string
// Since Supabase stores Asia/Kolkata, we need to ensure the query strings also reflect IST.
const getDayRangeForQuery = (dateString: string) => {
  // Append the IST offset to ensure Supabase correctly filters within the IST day
  const start = `${dateString}T00:00:00+05:30`;
  const end = `${dateString}T23:59:59+05:30`;
  return { start, end };
};

const getTodayDateRange = () => {
  // Use Intl.DateTimeFormat to get the current date string in Asia/Kolkata timezone
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  const istDateString = istFormatter.format(now); // This gives 'YYYY-MM-DD' in IST

  return {
    ...getDayRangeForQuery(istDateString),
    displayDate: istDateString, // For display purposes
  };
};

const getThisWeekRange = () => {
  const now = new Date();
  // Get the current date in IST as a Date object that date-fns can work with
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  const startOfWeekIST = startOfWeek(istNow, { weekStartsOn: 1 }); // Monday in IST
  const endOfWeekIST = endOfWeek(istNow, { weekStartsOn: 1 }); // Sunday in IST

  // Format with explicit IST offset for Supabase query
  const start = format(startOfWeekIST, "yyyy-MM-dd'T'00:00:00+05:30");
  const end = format(endOfWeekIST, "yyyy-MM-dd'T'23:59:59+05:30");

  return {
    start,
    end,
    displayStart: format(startOfWeekIST, "yyyy-MM-dd"), // For display
    displayEnd: format(endOfWeekIST, "yyyy-MM-dd"),     // For display
  };
};

const getMonthRange = (monthYear: string) => {
  const [year, month] = monthYear.split("-").map(Number);
  // Create a Date object for the first day of the month.
  // We use the year and month to construct a Date, which date-fns will handle.
  // The crucial part is to ensure the formatted string for Supabase carries the IST offset.
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const startOfPeriod = startOfMonth(firstDayOfMonth);
  const endOfPeriod = endOfMonth(firstDayOfMonth);

  // Format with explicit IST offset for Supabase query
  const start = format(startOfPeriod, "yyyy-MM-dd'T'00:00:00+05:30");
  const end = format(endOfPeriod, "yyyy-MM-dd'T'23:59:59+05:30");

  return {
    start,
    end,
    displayStart: format(startOfPeriod, "yyyy-MM-dd"), // For display
    displayEnd: format(endOfPeriod, "yyyy-MM-dd"),     // For display
  };
};


// --- Helper functions for patient and room fetching ---
async function fetchPatientDetailByUhid(uhid: string) {
  if (!uhid) return null;
  const { data, error } = await supabase
    .from("patient_detail")
    .select("uhid, name, number, age, gender, address")
    .eq("uhid", uhid)
    .single();
  if (error) return null;
  return data;
}

async function fetchRoomTypeByBedId(bed_id: number | null) {
  if (!bed_id) return null;
  const { data, error } = await supabase
    .from("bed_management")
    .select("room_type")
    .eq("id", bed_id)
    .single();
  if (error) return null;
  return data?.room_type || null;
}

// ----- Dashboard Component -----
const DashboardPage: React.FC = () => {
  // State
  const [opdAppointments, setOpdAppointments] = useState<OPDAppointmentDisplay[]>([])
  const [ipdAppointments, setIpdAppointments] = useState<IPDAppointmentDisplay[]>([])
  const [otAppointments, setOtAppointments] = useState<OTAppointmentDisplay[]>([])
  const [doctors, setDoctors] = useState<{ [key: string]: Doctor }>({})
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: "",
    filterType: "today", // Set default to 'today'
    selectedMonth: format(new Date(), "yyyy-MM"), // Default month for current date
    startDate: "",
    endDate: "",
    showOnlyOpd: false, // New filter
    showOnlyIpd: false, // New filter
    showOnlyOt: false, // New filter
    showOnlyBabyBirth: false, // New filter
  })
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [selectedAppointment, setSelectedAppointment] = useState<CombinedAppointment | null>(null)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [modalLoading, setModalLoading] = useState<boolean>(false)

  // New states for patient search and appointments modal
  const [searchedPatients, setSearchedPatients] = useState<PatientInfo[]>([])
  const [selectedPatientForAppointments, setSelectedPatientForAppointments] = useState<PatientInfo | null>(null)
  const [patientAppointmentsModalOpen, setPatientAppointmentsModalOpen] = useState<boolean>(false)
  const [patientAppointmentsLoading, setPatientAppointmentsLoading] = useState<boolean>(false)
  const [patientAllAppointments, setPatientAllAppointments] = useState<CombinedAppointment[]>([])
  const [babyBirthsData, setBabyBirthsData] = useState<OTDetailsSupabase[]>([]); // New state for baby births

  // Data download size tracking (conceptual for Supabase, as actual bytes are harder to track)
  const [totalDownloadedBytes, setTotalDownloadedBytes] = useState(0)
  const [searchDownloadedBytes, setSearchDownloadedBytes] = useState(0)

  // New state for IPD totals
  const [ipdTotals, setIpdTotals] = useState<{
    cash_total: number;
    online_total: number;
    online_upi_total: number;
    online_card_total: number;
    online_netbanking_total: number;
    online_cheque_total: number;
  } | null>(null);
  const [totalPathologyCount, setTotalPathologyCount] = useState<number>(0);
  const [totalDialysisCount, setTotalDialysisCount] = useState<number>(0);
  const [totalXrayCount, setTotalXrayCount] = useState<number>(0);
  const [totalDischarges, setTotalDischarges] = useState<number>(0);

  // Compute current date range for the dashboard display and the query
  const currentDateRange = useMemo(() => {
    let range: { start: string; end: string; displayStart: string; displayEnd: string }

    switch (filters.filterType) {
      case "today": {
        const todayRange = getTodayDateRange();
        range = {
          start: todayRange.start,
          end: todayRange.end,
          displayStart: todayRange.displayDate,
          displayEnd: todayRange.displayDate,
        };
        break;
      }
      case "month": {
        range = getMonthRange(filters.selectedMonth);
        break;
      }
      case "dateRange": {
        // For custom date range, the inputs (filters.startDate/endDate) are already YYYY-MM-DD local strings.
        const startRange = getDayRangeForQuery(filters.startDate);
        const endRange = getDayRangeForQuery(filters.endDate);
        range = {
          start: startRange.start,
          end: endRange.end,
          displayStart: filters.startDate,
          displayEnd: filters.endDate,
        };
        break;
      }
      case "week":
      default: {
        range = getThisWeekRange();
        break;
      }
    }

    return {
      start: range.start, // ISO string with offset for query
      end: range.end,   // ISO string with offset for query
      displayStart: range.displayStart, // For display in filters
      displayEnd: range.displayEnd, // For display in filters
    }
  }, [filters])

  // Fetch doctors once (assuming a 'doctor' table in Supabase)
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        const { data, error } = await supabase.from("doctor").select("id, dr_name, department, specialist, opd_charge");
        if (error || !data) {
          console.error("Supabase doctor fetch error:", error, data);
          // toast.error("Failed to load doctor data."); // HIDE error message from user
          setDoctors({});
          return;
        }
        const doctorsMap: { [key: string]: Doctor } = {};
        data.forEach((doc: any) => {
          doctorsMap[String(doc.id)] = {
            id: String(doc.id),
            dr_name: doc.dr_name,
            department: doc.department,
            specialist: doc.specialist,
            opd_charge: doc.opd_charge || 0,
          };
        });
        setDoctors(doctorsMap);
      } catch (err) {
        console.error("Failed to fetch doctors (exception):", err);
        // toast.error("Failed to load doctor data."); // HIDE error message from user
        setDoctors({});
      }
    };
    fetchDoctors();
  }, []);

  useEffect(() => {
    async function fetchTotals() {
      if (!currentDateRange.start || !currentDateRange.end) {
        setIpdTotals(null);
        return;
      }
      const { data, error } = await supabase.rpc("get_ipd_total_amount", {
        start_date: currentDateRange.displayStart,
        end_date: currentDateRange.displayEnd,
      });

      if (error) {
        console.error("Error fetching IPD totals:", error);
        toast.error("Failed to load IPD totals.");
        setIpdTotals(null);
      } else if (data && data.length > 0) {
        setIpdTotals(data[0]);
      } else {
        setIpdTotals(null);
      }
    }
    fetchTotals();
  }, [currentDateRange]); // Re-run when the date range changes

  // Main data fetching logic (combines initial load and filter changes)
  useEffect(() => {
    const fetchAppointments = async () => {
      const isRefresh = !isLoading
      if (isRefresh) setRefreshing(true)
      setIsLoading(true)

      setOpdAppointments([])
      setIpdAppointments([])
      setOtAppointments([])
      setSearchedPatients([]) // Clear previous search results
      setTotalDownloadedBytes(0)

      if (filters.searchQuery) {
        // --- Search mode ---
        const searchQ = filters.searchQuery.trim();
        if (searchQ.length < 3) {
          setIsLoading(false)
          setSearchedPatients([])
          setSearchDownloadedBytes(0)
          setRefreshing(false) // Ensure refreshing is reset
          return
        }

        const q = searchQ.toLowerCase();
        try {
          let mergedResults: Record<string, PatientDetailFromSupabase> = {};

          // Search by UHID and Name (case-insensitive, partial match)
          const { data: nameUhidData, error: nameUhidError } = await supabase
            .from("patient_detail")
            .select("uhid, name, number, age, gender, address")
            .or(`name.ilike.%${q}%,uhid.ilike.%${q}%`)
            .limit(20); // Limit results for performance

          if (nameUhidError) {
            console.error("Supabase name/UHID search error:", nameUhidError);
            throw nameUhidError; // Propagate error to catch block
          }
          (nameUhidData || []).forEach((p) => {
            if (p.uhid) mergedResults[p.uhid] = p;
          });

          // If query is all digits, also search by number
          if (/^\d+$/.test(searchQ)) {
            const { data: phoneData, error: phoneError } = await supabase
              .from("patient_detail")
              .select("uhid, name, number, age, gender, address")
              .eq("number", searchQ) // Number column is text in your schema based on patient_detail type def, if it's bigint use Number(searchQ)
              .limit(20);

            if (phoneError) {
              console.error("Supabase phone search error:", phoneError);
              throw phoneError; // Propagate error to catch block
            }
            (phoneData || []).forEach((p) => {
              if (p.uhid) mergedResults[p.uhid] = p;
            });
          }

          const mappedPatients: PatientInfo[] = Object.values(mergedResults).map((p) => ({
            uhid: p.uhid,
            name: p.name || "Unknown", // Use 'Unknown' for null names
            phone: p.number || "N/A", // Use 'N/A' for null numbers
            age: p.age || null,
            address: p.address || null,
            gender: p.gender || null,
          }));
          setSearchedPatients(mappedPatients);
          setSearchDownloadedBytes(JSON.stringify(mappedPatients).length);
        } catch (err) {
          console.error("Error searching patients:", err);
          toast.error("Failed to search patients.");
          setSearchedPatients([]);
          setSearchDownloadedBytes(0);
        } finally {
          setIsLoading(false);
          setRefreshing(false);
        }
        return; // EXIT here if in search mode
      }

      // --- Date filter mode (when no search query) ---
      const { start, end } = currentDateRange
      if (!start || !end) {
        setIsLoading(false)
        if (isRefresh) setRefreshing(false)
        return
      }

      try {
        // Use the appropriate date column for filtering
        const dateColumnForOPD = filters.filterType === 'today' ? 'date' : 'created_at';
        const dateColumnForIPD = filters.filterType === 'today' ? 'admission_date' : 'created_at';
        const dateColumnForOT = 'ot_date'; // Always use ot_date for OT filtering, regardless of filter type

        // For today filter, we need to use simple date strings for date columns
        const todayDateString = filters.filterType === 'today' ? currentDateRange.displayStart : null;
        
        // Debug logging for today filter
        if (filters.filterType === 'today') {
          console.log('Today filter active, using date string:', todayDateString);
          console.log('OT query parameters:', {
            todayStart: `${todayDateString}T00:00:00`,
            todayEnd: `${todayDateString}T23:59:59`
          });
        }

        // Fetch OPD data
        let opdData: OPDRegistrationSupabase[] | null = [];
        if (!filters.showOnlyIpd && !filters.showOnlyOt && !filters.showOnlyBabyBirth) { // Only fetch if not exclusively filtering for OPD/OT/Baby Birth
          let opdQuery = supabase
            .from("opd_registration")
            .select(`
              opd_id,
              created_at,
              patient_id,
              date,
              refer_by,
              "additional Notes",
              service_info,
              payment_info,
              bill_no,
              uhid
            `);

          // Always filter OPD by `created_at`
          opdQuery = opdQuery.gte('created_at', start).lte('created_at', end);

          const { data, error } = await opdQuery;
          if (error) throw error;
          opdData = data;
        }

        const mappedOpd: OPDAppointmentDisplay[] = await Promise.all(
          ((opdData as OPDRegistrationSupabase[]) || []).map(async (appt) => {
            const patientDetail = await fetchPatientDetailByUhid(appt.uhid); // Fetch patient details here
            // Handle date parsing - it might be a simple date string or ISO timestamp
            let opdDate: Date;
            try {
              opdDate = parseISO(appt.date);
            } catch (error) {
              // If parsing fails, assume it's a simple date string and add time
              opdDate = parseISO(`${appt.date}T00:00:00`);
            }
            
            const createdAtDate = parseISO(appt.created_at); // Parse as is

            return {
              ...appt,
              type: "OPD",
              id: String(appt.opd_id),
              patientId: patientDetail?.uhid || appt.uhid || "N/A",
              name: patientDetail?.name || "Unknown",
              phone: patientDetail?.number ? String(patientDetail.number) : "N/A",
              date: format(createdAtDate, "yyyy-MM-dd"), // Use created_at for date
              time: format(createdAtDate, "HH:mm"), // Use created_at for time
              modalities: (appt.service_info as IModality[]) || [],
              payment: (appt.payment_info as IPayment) || {
                cashAmount: 0,
                createdAt: "",
                discount: 0,
                onlineAmount: 0,
                paymentMethod: "cash",
                totalCharges: 0,
                totalPaid: 0,
              },
              message: appt["additional Notes"] || "",
              patient_uhid_from_opd_table: appt.uhid,
              additional_notes: appt["additional Notes"],
              bill_no: appt.bill_no,
              appointment_type: (appt as any).appointment_type,
              visit_type: (appt as any).visit_type,
            }
          })
        );
        setOpdAppointments(mappedOpd)

        // Fetch IPD data
        let ipdData: IPDRegistrationSupabase[] | null = [];
        if (!filters.showOnlyOpd && !filters.showOnlyOt && !filters.showOnlyBabyBirth) { // Only fetch if not exclusively filtering for OPD/OT/Baby Birth
          let ipdQuery = supabase
            .from("ipd_registration")
            .select(`
              ipd_id,
              uhid,
              admission_date,
              admission_time,
              under_care_of_doctor,
              payment_detail,
              service_detail,
              created_at,
              bed_id,
              ipd_notes,
              tpa
            `);

          // Always filter IPD by `created_at`
          ipdQuery = ipdQuery.gte('created_at', start).lte('created_at', end);

          const { data, error } = await ipdQuery;
          if (error) throw error;
          ipdData = data;
        }
        
        // Debug logging for IPD results
        if (filters.filterType === 'today') {
          console.log('IPD query results for today:', ipdData?.length || 0, 'records');
          console.log('IPD data:', ipdData);
        }
        const mappedIpd: IPDAppointmentDisplay[] = await Promise.all(
          ((ipdData as IPDRegistrationSupabase[]) || []).map(async (ipdRecord) => {
            const payments = (ipdRecord.payment_detail || []) as IPDPayment[]
            let totalDeposit = 0
            let totalRefunds = 0
            let totalDiscount = 0

            payments.forEach((p) => {
              const amtType = p.amountType?.toLowerCase();
              const pType = p.type?.toLowerCase();
              const pPaymentType = p.paymentType?.toLowerCase();
              const pTransactionType = p.transactionType?.toLowerCase();

              if (
                amtType === "advance" || amtType === "deposit" || amtType === "settlement" ||
                pType === "advance" || pType === "deposit" || pTransactionType === "settlement"
              ) {
                totalDeposit += p.amount;
              } else if (
                amtType === "refund" || pType === "refund" || pTransactionType === "refund"
              ) {
                totalRefunds += p.amount;
              } else if (
                amtType === "discount" || pType === "discount" || pPaymentType === "bill_reduction"
              ) {
                totalDiscount += p.amount;
              }
            })

            const services = (ipdRecord.service_detail || []) as IPDService[]
            const totalServiceAmount = services.reduce((sum, s) => sum + s.amount, 0)
            const remaining = totalServiceAmount - totalDeposit - totalDiscount + totalRefunds;
            
            // Fetch patient details and room type separately like in main dashboard
            const patientDetail = await fetchPatientDetailByUhid(ipdRecord.uhid);
            const roomType = await fetchRoomTypeByBedId(ipdRecord.bed_id);
            
            // Parse created_at for date and time display
            const createdAtDate = parseISO(ipdRecord.created_at);
            
            // Debug logging for each IPD appointment
            console.log('IPD appointment patient detail:', {
              uhid: ipdRecord.uhid,
              patientDetail: patientDetail,
              name: patientDetail?.name || "Unknown",
              phone: patientDetail?.number || "N/A"
            });

            return {
              ...ipdRecord,
              type: "IPD",
              id: String(ipdRecord.ipd_id),
              patientId: patientDetail?.uhid || ipdRecord.uhid || "N/A",
              name: patientDetail?.name || "Unknown",
              phone: patientDetail?.number ? String(patientDetail.number) : "N/A",
              totalAmount: totalServiceAmount,
              totalDeposit: totalDeposit,
              totalRefunds: totalRefunds,
              discount: totalDiscount,
              remainingAmount: remaining,
              roomType: roomType || "N/A",
              admission_date: format(createdAtDate, "yyyy-MM-dd"), // Use created_at for admission_date
              admission_time: format(createdAtDate, "HH:mm"), // Use created_at for admission_time
              ipd_notes: ipdRecord.ipd_notes || null,
              tpa: ipdRecord.tpa,
            }
          })
        );
        setIpdAppointments(mappedIpd)

        // Fetch OT data
        let otData: OTDetailsSupabase[] | null = [];
        if (!filters.showOnlyOpd && !filters.showOnlyIpd) { // Only fetch if not exclusively filtering for OPD/IPD
          let otQuery = supabase
            .from("ot_details")
            .select(
              `
                id, ipd_id, uhid, ot_type, ot_notes, ot_date, created_at, has_baby_birth, baby_birth_date, baby_birth_weight, baby_birth_gender, location_type
              `,
            )
            .order("created_at", { ascending: false })

          // Always filter by ot_date (the selected OT date), not by created_at or IPD admission date
          // The existing logic already handles ot_date correctly for today/other filters, so no change needed here.
          // For today filter, use date range comparison for ot_date
          const todayStart = `${todayDateString}T00:00:00+05:30`;
          const todayEnd = `${todayDateString}T23:59:59+05:30`;
          if (filters.filterType === 'today') {
              otQuery = otQuery.gte('ot_date', todayStart).lte('ot_date', todayEnd);
          } else {
              otQuery = otQuery.gte('ot_date', start).lte('ot_date', end);
          }

          // Add filter for only baby births if selected
          if (filters.showOnlyBabyBirth) {
            otQuery = otQuery.eq('has_baby_birth', true);
          }

          const { data, error } = await otQuery;
          if (error) throw error;
          otData = data;
        }

        // Fetch baby births data specifically (similar to DPR)
        let babyBirthsRecords: OTDetailsSupabase[] | null = [];
        if (!filters.showOnlyOpd && !filters.showOnlyIpd) {
          const { data, error } = await supabase
            .from('ot_details')
            .select(`id, ipd_id, uhid, ot_type, ot_notes, ot_date, created_at, has_baby_birth, baby_birth_date, baby_birth_weight, baby_birth_gender, location_type`)
            .eq('has_baby_birth', true)
            .gte('created_at', start)
            .lte('created_at', end);
          if (error) throw error;
          babyBirthsRecords = data;
        }
        setBabyBirthsData(babyBirthsRecords || []);

        // Debug logging for OT results
        if (filters.filterType === 'today') {
          console.log('OT query results for today (filtered by ot_date):', otData?.length || 0, 'records');
          console.log('OT data:', otData);
          if (otData && otData.length > 0) {
            console.log('OT dates in database:', otData.map(ot => ot.ot_date));
          }
        } else {
          console.log(`OT query results for date range (filtered by ot_date):`, otData?.length || 0, 'records');
          if (otData && otData.length > 0) {
            console.log('OT dates in database:', otData.map(ot => ot.ot_date));
          }
        }
        const mappedOt: OTAppointmentDisplay[] = await Promise.all(
          ((otData as OTDetailsSupabase[]) || []).map(async (otRecord) => {
            // Handle ot_date parsing - it might be a simple date string or ISO timestamp
            let otDate: Date;
            try {
              otDate = parseISO(otRecord.ot_date);
            } catch (error) {
              // If parsing fails, assume it's a simple date string and add time
              otDate = parseISO(`${otRecord.ot_date}T00:00:00`);
            }
            
            const createdAtDate = parseISO(otRecord.created_at); // Parse as is
            const patientDetail = await fetchPatientDetailByUhid(otRecord.uhid); // Fetch patient details here
            return {
              ...otRecord,
              type: "OT",
              id: otRecord.id,
              patientId: patientDetail?.uhid || otRecord.uhid || "N/A",
              name: patientDetail?.name || "Unknown",
              phone: patientDetail?.number ? String(patientDetail.number) : "N/A",
              date: format(otDate, "yyyy-MM-dd"), // Directly format
              time: format(createdAtDate, "HH:mm"), // Directly format
              message: otRecord.ot_notes || "No notes",
              has_baby_birth: otRecord.has_baby_birth,
              baby_birth_date: otRecord.baby_birth_date,
              baby_birth_weight: otRecord.baby_birth_weight,
              baby_birth_gender: otRecord.baby_birth_gender,
              location_type: otRecord.location_type,
            }
          })
        );
        setOtAppointments(mappedOt)
        // Debugging for baby births location type
        mappedOt.filter(ot => ot.has_baby_birth).forEach(ot => {
          console.log(`Baby Birth OT ID: ${ot.id}, Location Type: ${ot.location_type}, Has Baby Birth: ${ot.has_baby_birth}`);
        });

        setTotalDownloadedBytes(
          JSON.stringify(mappedOpd).length + JSON.stringify(mappedIpd).length + JSON.stringify(mappedOt).length,
        )
        // Fetch Pathology count
        try {
          const res = await fetch('/api/lab/pathology-count', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: currentDateRange.displayStart })
          });
          if (res.ok) {
            const json = await res.json();
            if (json && typeof json.count === 'number') {
              setTotalPathologyCount(json.count);
            }
          } else {
            console.warn('Failed to fetch pathology count for dashboard');
            setTotalPathologyCount(0);
          }
        } catch (e) {
          console.error('Error fetching pathology count for dashboard', e);
          setTotalPathologyCount(0);
        }

        // Fetch X-ray count
        try {
          const xrayApiDate = format(parseISO(currentDateRange.displayStart), 'dd-MM-yyyy');
          const hospitalName = process.env.NEXT_PUBLIC_LAB_HOSPITAL_NAME || '';

          if (!process.env.NEXT_PUBLIC_LAB_API_KEY) {
            console.error("NEXT_PUBLIC_LAB_API_KEY is not set. Skipping X-ray count API call on dashboard.");
            setTotalXrayCount(0);
          } else {
            const res = await fetch('https://labapi.infispark.in/rest/v1/rpc/get_registration_count_xray', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.NEXT_PUBLIC_LAB_API_KEY,
                'Authorization': `Bearer ${process.env.NEXT_PUBLIC_LAB_API_KEY}`,
              },
              body: JSON.stringify({ p_date: xrayApiDate, p_hospital: hospitalName })
            });
  
            if (res.ok) {
              const json = await res.json();
              if (typeof json === 'number') {
                setTotalXrayCount(json);
              } else if (json && Array.isArray(json) && json.length > 0 && typeof json[0].count === 'number') {
                setTotalXrayCount(json[0].count);
              } else {
                console.warn('X-ray API response format unexpected on dashboard:', json);
                setTotalXrayCount(0);
              }
            } else {
              console.warn('Failed to fetch X-ray count from API on dashboard:', res.status, res.statusText);
              setTotalXrayCount(0);
            }
          }
        } catch (e) {
          console.error('Error while fetching X-ray count on dashboard:', e);
          setTotalXrayCount(0);
        }
        
        // Calculate Total Dialysis and other service types from OPD appointments
        let dialysisCount = 0;
        mappedOpd.forEach(opd => {
          if (opd.service_info) {
            opd.service_info.forEach(service => {
              if (service.type?.toLowerCase() === 'casualty' && service.service?.toLowerCase().includes('dialysis')) {
                dialysisCount++;
              }
            });
          }
        });
        setTotalDialysisCount(dialysisCount);

        // Fetch Discharges
        try {
          const { data: dischargeData, error: dischargeError } = await supabase
            .from('discharge_summaries')
            .select('id') // Only need to count them
            .gte('last_updated', start).lte('last_updated', end);
          
          if (dischargeError) throw dischargeError;
          setTotalDischarges(dischargeData?.length || 0);
        } catch (e) {
          console.error('Error fetching discharge summaries:', e);
          setTotalDischarges(0);
        }
      } catch (err) {
        console.error("Error fetching data for date range:", err)
        toast.error("Failed to load data for the selected period.")
      } finally {
        setIsLoading(false)
        if (isRefresh) setRefreshing(false)
      }
    }
    fetchAppointments()
  }, [filters.searchQuery, currentDateRange, filters.showOnlyOpd, filters.showOnlyIpd, filters.showOnlyOt, filters.showOnlyBabyBirth]) // Re-run effect when searchQuery or currentDateRange changes

  // Statistics
  const statistics = useMemo(() => {
    const totalOpdAmt = opdAppointments.reduce((sum, a) => sum + (a.payment?.totalPaid || 0), 0)
    // Recalculate IPD totals based on the new logic
    const totalIpdDeposits = ipdAppointments.reduce((sum, a) => sum + a.totalDeposit, 0);
    const totalIpdRefunds = ipdAppointments.reduce((sum, a) => sum + a.totalRefunds, 0);
    // Net contribution from IPD to total revenue (Deposits - Refunds)
    const netIpdContribution = totalIpdDeposits - totalIpdRefunds;


    const opdCash = opdAppointments.reduce((sum, a) => sum + (a.payment?.cashAmount || 0), 0)
    const opdOnline = opdAppointments.reduce((sum, a) => sum + (a.payment?.onlineAmount || 0), 0)

    // Calculate IPD cash and online based on contributions TO the hospital
    const ipdCash = ipdAppointments.reduce(
      (sum, a) =>
        sum +
        (a.payment_detail || [])
          .filter((p) => {
            const amtType = p.amountType?.toLowerCase();
            const pType = p.type?.toLowerCase();
            const pPaymentType = p.paymentType?.toLowerCase();
            const pTransactionType = p.transactionType?.toLowerCase();
            return (
              p.paymentType?.toLowerCase() === "cash" &&
              (amtType === "advance" || amtType === "deposit" || amtType === "settlement" ||
                pType === "advance" || pType === "deposit" || pTransactionType === "settlement")
            );
          })
          .reduce((s, p) => s + Number(p.amount), 0),
      0,
    )
    const ipdOnline = ipdAppointments.reduce(
      (sum, a) =>
        sum +
        (a.payment_detail || [])
          .filter((p) => {
            const amtType = p.amountType?.toLowerCase();
            const pType = p.type?.toLowerCase();
            const pPaymentType = p.paymentType?.toLowerCase();
            const pTransactionType = p.transactionType?.toLowerCase();
            return (
              p.paymentType?.toLowerCase() === "online" &&
              (amtType === "advance" || amtType === "deposit" || amtType === "settlement" ||
                pType === "advance" || pType === "deposit" || pTransactionType === "settlement")
            );
          })
          .reduce((s, p) => s + Number(p.amount), 0),
      0,
    )

    return {
      totalOpdCount: opdAppointments.length,
      totalOpdAmount: totalOpdAmt,
      totalIpdCount: ipdAppointments.length,
      totalIpdAmount: netIpdContribution, // This is now net deposits after refunds (deposits - refunds)
      overallIpdRefunds: totalIpdRefunds,
      totalOtCount: otAppointments.length, // This already gives the count of OT procedures
      totalBabyBirths: babyBirthsData.length, // FIX: Use pre-filtered babyBirthsData for total
      totalTpaIpd: ipdAppointments.filter(ipd => ipd.tpa).length, // New: Total TPA IPD
      totalMajorOt: otAppointments.filter(ot => ot.ot_type?.toLowerCase() === 'major').length, // New: Total Major OT
      totalMinorOt: otAppointments.filter(ot => ot.ot_type?.toLowerCase() === 'minor').length, // New: Total Minor OT
      totalPathology: totalPathologyCount, // New: Total Pathology
      totalDialysis: totalDialysisCount, // New: Total Dialysis
      totalXray: totalXrayCount, // New: Total X-ray
      totalDischarges: totalDischarges, // New: Total Discharges
      totalBirthsWithLabor: babyBirthsData.filter(ot => ot.location_type === 'Labour Room').length, // New: Total Births with Labor
      totalBirthsWithOt: babyBirthsData.filter(ot => ot.location_type === 'OT').length, // New: Total Births with OT
      opdCash,
      opdOnline,
      ipdCash,
      ipdOnline,
      totalRevenue: totalOpdAmt + (ipdTotals?.cash_total || 0) + (ipdTotals?.online_total || 0), // Total revenue includes IPD total collections
    }
  }, [opdAppointments, ipdAppointments, otAppointments, ipdTotals, totalPathologyCount, totalDialysisCount, totalXrayCount, totalDischarges, babyBirthsData])

  // Combined & filter by date range (search is handled by fetching patientinfo directly)
  const filteredAppointments = useMemo(() => {
    if (filters.searchQuery) {
      return [] // In search mode, this memo is not used for display
    }
    let all: CombinedAppointment[] = [...opdAppointments, ...ipdAppointments, ...otAppointments]
    
    // Apply new filters
    if (filters.showOnlyOpd) {
      all = all.filter(app => app.type === "OPD");
    }
    if (filters.showOnlyIpd) {
      all = all.filter(app => app.type === "IPD");
    }
    if (filters.showOnlyOt) {
      all = all.filter(app => app.type === "OT");
    }
    if (filters.showOnlyBabyBirth) {
      all = all.filter(app => app.type === "OT" && (app as OTAppointmentDisplay).has_baby_birth);
    }

    const list = all

    // Sorting by date (most recent first)
    list.sort((a, b) => {
      // Parse dates directly from string as they are assumed to be in the correct timezone (IST)
      const getDateAndTime = (app: CombinedAppointment) => {
        let dateStr: string
        let timeStr: string | null

        if (app.type === "IPD") {
          // IPD now uses created_at for date and time
          dateStr = app.admission_date; // This is now formatted created_at date
          timeStr = app.admission_time; // This is now formatted created_at time
        } else if (app.type === "OT") {
          dateStr = app.date // Use the already formatted `date` (ot_date in IST)
          timeStr = app.time // Use the already formatted `time` (created_at time in IST)
        } else {
          // OPD now uses created_at for date and time
          dateStr = app.date; // This is now formatted created_at date
          timeStr = app.time; // This is now formatted created_at time
        }

        // Combine date and time and parse as an ISO string directly
        return parseISO(`${dateStr}T${timeStr || "00:00"}`);
      }

      const dateTimeA = getDateAndTime(a)
      const dateTimeB = getDateAndTime(b)

      return dateTimeB.getTime() - dateTimeA.getTime()
    })
    return list
  }, [opdAppointments, ipdAppointments, otAppointments, filters.searchQuery, filters.showOnlyOpd, filters.showOnlyIpd, filters.showOnlyOt, filters.showOnlyBabyBirth])

  // Doctor consultations
  const doctorConsultations = useMemo(() => {
    const map = new Map<string, number>()
    opdAppointments.forEach((a) =>
      a.modalities
        .filter((m) => m.type === "consultation" && m.doctor)
        .forEach((m) => map.set(m.doctor!, (map.get(m.doctor!) || 0) + 1)),
    )
    return Array.from(map.entries())
      .map(([doctorName, count]) => ({ doctorName, count }))
      .sort((a, b) => b.count - a.count)
  }, [opdAppointments])

  const doctorConsultChartData = useMemo(() => {
    const top = doctorConsultations.slice(0, 10)
    return {
      labels: top.map((d) => d.doctorName),
      datasets: [
        {
          label: "Consultations",
          data: top.map((d) => d.count),
          backgroundColor: "rgba(75,192,192,0.6)",
          borderWidth: 1,
        },
      ],
    }
  }, [doctorConsultations])

  // Handlers
  const handleDateRangeChange = (startStr: string, endStr: string) => {
    if (startStr && endStr) {
      const startDate = parseISO(startStr)
      const endDate = parseISO(endStr)

      const diff = differenceInDays(endDate, startDate)
      if (diff > 30) {
        toast.error("Date range cannot exceed 30 days")
        const maxEnd = addDays(startDate, 30)
        setFilters((p) => ({
          ...p,
          startDate: startStr,
          endDate: format(maxEnd, "yyyy-MM-dd"),
          filterType: "dateRange",
        }))
      } else {
        setFilters((p) => ({
          ...p,
          startDate: startStr,
          endDate: endStr,
          filterType: "dateRange",
        }))
      }
    } else {
      setFilters((p) => ({ ...p, startDate: startStr, endDate: endStr }))
    }
  }

  const handleFilterChange = (upd: Partial<FilterState>) => {
    if (upd.filterType === "today") {
      setFilters((p) => ({
        ...p,
        filterType: "today",
        startDate: "",
        endDate: "",
        selectedMonth: format(new Date(), "yyyy-MM"),
        searchQuery: "",
        showOnlyOpd: false, // Reset new filters
        showOnlyIpd: false,
        showOnlyOt: false,
        showOnlyBabyBirth: false,
      }))
    } else if (upd.filterType === "week") {
      setFilters((p) => ({
        ...p,
        filterType: "week",
        startDate: "",
        endDate: "",
        selectedMonth: format(new Date(), "yyyy-MM"),
        searchQuery: "",
        showOnlyOpd: false, // Reset new filters
        showOnlyIpd: false,
        showOnlyOt: false,
        showOnlyBabyBirth: false,
      }))
    } else if (upd.filterType === "month") {
      setFilters((p) => ({
        ...p,
        filterType: "month",
        startDate: "",
        endDate: "",
        selectedMonth: upd.selectedMonth || format(new Date(), "yyyy-MM"),
        searchQuery: "",
        showOnlyOpd: false, // Reset new filters
        showOnlyIpd: false,
        showOnlyOt: false,
        showOnlyBabyBirth: false,
      }))
    } else if (upd.filterType === "dateRange") {
      setFilters((p) => ({
        ...p,
        ...upd,
        searchQuery: "",
        showOnlyOpd: false, // Reset new filters
        showOnlyIpd: false,
        showOnlyOt: false,
        showOnlyBabyBirth: false,
      }))
    } else {
      setFilters((p) => ({ ...p, ...upd }))
    }
  }

  const resetFilters = () =>
    setFilters({
      searchQuery: "",
      filterType: "today",
      selectedMonth: format(new Date(), "yyyy-MM"),
      startDate: "",
      endDate: "",
      showOnlyOpd: false,
      showOnlyIpd: false,
      showOnlyOt: false,
      showOnlyBabyBirth: false,
    })

  // Modal for individual appointment details
  const openModal = async (app: CombinedAppointment) => {
    setModalLoading(true)
    setIsModalOpen(true)
    setSelectedAppointment(app)
    setModalLoading(false)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedAppointment(null)
  }

  // New: Fetch all appointments for a specific patient (for patient search modal)
  const fetchAllAppointmentsForPatient = useCallback(
    async (uhid: string) => {
      console.log('Fetching appointments for UHID:', uhid);
      setPatientAppointmentsLoading(true)
      const allPatientApps: CombinedAppointment[] = []

      try {
        // Use the same approach as main dashboard queries - fetch patient details separately
        const { data: opdData, error: opdError } = await supabase
          .from("opd_registration")
          .select(
            `
              opd_id, created_at, date, refer_by, "additional Notes", service_info, payment_info, bill_no, uhid, patient_id
            `,
          )
          .eq("uhid", uhid)
          .order("created_at", { ascending: false })

        if (opdError) throw opdError
        
        // Debug logging for OPD data
        console.log('OPD data:', opdData);
        
        const mappedOpd: OPDAppointmentDisplay[] = await Promise.all(((opdData as OPDRegistrationSupabase[]) || []).map(async (appt) => {
          // Fetch patient details separately like in main dashboard
          const patientDetail = await fetchPatientDetailByUhid(appt.uhid);
          
          // Direct use of DB dates/times
          const createdAtDate = parseISO(appt.created_at);
          const opdDate = parseISO(appt.date);
          
          // Debug logging for each appointment
          console.log('OPD appointment patient detail:', {
            uhid: appt.uhid,
            patientDetail: patientDetail,
            name: patientDetail?.name || "Unknown",
            phone: patientDetail?.number || "N/A"
          });
          
          return {
            ...appt,
            type: "OPD",
            id: String(appt.opd_id),
            patientId: patientDetail?.uhid || appt.uhid || "N/A",
            name: patientDetail?.name || "Unknown",
            phone: patientDetail?.number ? String(patientDetail.number) : "N/A",
            date: format(createdAtDate, "yyyy-MM-dd"), // Use created_at for date
            time: format(createdAtDate, "HH:mm"), // Use created_at for time
            modalities: (appt.service_info as IModality[]) || [],
            payment: (appt.payment_info as IPayment) || {
              cashAmount: 0,
              createdAt: "",
              discount: 0,
              onlineAmount: 0,
              paymentMethod: "cash",
              totalCharges: 0,
              totalPaid: 0,
            },
            message: appt["additional Notes"] || "",
            patient_uhid_from_opd_table: appt.uhid,
            additional_notes: appt["additional Notes"],
            bill_no: appt.bill_no,
            appointment_type: (appt as any).appointment_type,
            visit_type: (appt as any).visit_type,
          }
        }))
        allPatientApps.push(...mappedOpd)

        const { data: ipdData, error: ipdError } = await supabase
          .from("ipd_registration")
          .select(
            `
              ipd_id, uhid, admission_date, admission_time, under_care_of_doctor, payment_detail, service_detail, created_at, bed_id, ipd_notes, tpa
            `,
          )
          .eq("uhid", uhid)
          .order("created_at", { ascending: false })

        if (ipdError) throw ipdError
        
        // Debug logging for IPD data
        console.log('IPD data:', ipdData);
        
        const mappedIpd: IPDAppointmentDisplay[] = await Promise.all(((ipdData as IPDRegistrationSupabase[]) || []).map(async (ipdRecord) => {
          const payments = (ipdRecord.payment_detail || []) as IPDPayment[]
          let totalDeposit = 0
          let totalRefunds = 0
          let totalDiscount = 0

          payments.forEach((p) => {
            const amtType = p.amountType?.toLowerCase();
            const pType = p.type?.toLowerCase();
            const pPaymentType = p.paymentType?.toLowerCase();
            const pTransactionType = p.transactionType?.toLowerCase();

            if (
              amtType === "advance" || amtType === "deposit" || amtType === "settlement" ||
              pType === "advance" || pType === "deposit" || pTransactionType === "settlement"
            ) {
              totalDeposit += p.amount;
            } else if (
              amtType === "refund" || pType === "refund" || pTransactionType === "refund"
            ) {
              totalRefunds += p.amount;
            } else if (
              amtType === "discount" || pType === "discount" || pPaymentType === "bill_reduction"
            ) {
              totalDiscount += p.amount;
            }
          })

          const services = (ipdRecord.service_detail || []) as IPDService[]
          const totalServiceAmount = services.reduce((sum, s) => sum + s.amount, 0)
          const remaining = totalServiceAmount - totalDeposit - totalDiscount + totalRefunds;
          
          // Fetch patient details and room type separately like in main dashboard
          const patientDetail = await fetchPatientDetailByUhid(ipdRecord.uhid);
          const roomType = await fetchRoomTypeByBedId(ipdRecord.bed_id);
          
          // Parse created_at for date and time display
          const createdAtDate = parseISO(ipdRecord.created_at);
          
          // Debug logging for each IPD appointment
          console.log('IPD appointment patient detail:', {
            uhid: ipdRecord.uhid,
            patientDetail: patientDetail,
            name: patientDetail?.name || "Unknown",
            phone: patientDetail?.number || "N/A"
          });

          return {
            ...ipdRecord,
            type: "IPD",
            id: String(ipdRecord.ipd_id),
            patientId: patientDetail?.uhid || ipdRecord.uhid || "N/A",
            name: patientDetail?.name || "Unknown",
            phone: patientDetail?.number ? String(patientDetail.number) : "N/A",
            totalAmount: totalServiceAmount,
            totalDeposit: totalDeposit,
            totalRefunds: totalRefunds,
            discount: totalDiscount,
            remainingAmount: remaining,
            roomType: roomType || "N/A",
            admission_date: format(createdAtDate, "yyyy-MM-dd"), // Use created_at for admission_date
            admission_time: format(createdAtDate, "HH:mm"), // Use created_at for admission_time
            ipd_notes: ipdRecord.ipd_notes || null,
            tpa: ipdRecord.tpa,
          }
        }))
        allPatientApps.push(...mappedIpd)

        const { data: otData, error: otError } = await supabase
          .from("ot_details")
          .select(
            `
              id, ipd_id, uhid, ot_type, ot_notes, ot_date, created_at, has_baby_birth, baby_birth_date, baby_birth_weight, baby_birth_gender, location_type
            `,
          )
          .order("created_at", { ascending: false })

        if (otError) throw otError
        
        // Debug logging for OT data
        console.log('OT data:', otData);
        
        const mappedOt: OTAppointmentDisplay[] = await Promise.all(((otData as OTDetailsSupabase[]) || []).map(async (otRecord) => {
          // Fetch patient details separately like in main dashboard
          const patientDetail = await fetchPatientDetailByUhid(otRecord.uhid);
          
          // Direct use of DB dates/times
          const otDate = parseISO(otRecord.ot_date);
          const createdAtDate = parseISO(otRecord.created_at);
          
          // Debug logging for each OT appointment
          console.log('OT appointment patient detail:', {
            uhid: otRecord.uhid,
            patientDetail: patientDetail,
            name: patientDetail?.name || "Unknown",
            phone: patientDetail?.number || "N/A"
          });
          
          return {
            ...otRecord,
            type: "OT",
            id: otRecord.id,
            patientId: patientDetail?.uhid || otRecord.uhid || "N/A",
            name: patientDetail?.name || "Unknown",
            phone: patientDetail?.number ? String(patientDetail.number) : "N/A",
            date: format(otDate, "yyyy-MM-dd"), // Directly format
            time: format(createdAtDate, "HH:mm"), // Directly format
            message: otRecord.ot_notes || "No notes",
            has_baby_birth: otRecord.has_baby_birth,
            baby_birth_date: otRecord.baby_birth_date,
            baby_birth_weight: otRecord.baby_birth_weight,
            baby_birth_gender: otRecord.baby_birth_gender,
            location_type: otRecord.location_type,
          }
        }))
        allPatientApps.push(...mappedOt)

        setPatientAllAppointments(
          allPatientApps.sort((a, b) => {
            const getDateAndTime = (app: CombinedAppointment) => {
              let dateStr: string
              let timeStr: string | null

              if (app.type === "IPD") {
                dateStr = app.admission_date
                timeStr = app.admission_time
              } else if (app.type === "OT") {
                dateStr = app.date // This will be the already formatted `ot_date` (YYYY-MM-DD string)
                timeStr = app.time // This will be the already formatted `created_at` time (HH:mm string)
              } else {
                // OPD
                dateStr = app.date // This will be the already formatted `date` (YYYY-MM-DD string)
                timeStr = app.time // This will be the already formatted `created_at` time (HH:mm string)
              }
              // Parse directly, assuming it's the correct time
              return parseISO(`${dateStr}T${timeStr || "00:00"}`)
            }
            const dateTimeA = getDateAndTime(a)
            const dateTimeB = getDateAndTime(b)

            return dateTimeB.getTime() - dateTimeA.getTime()
          }),
        )
      } catch (err) {
        console.error("Error fetching patient's appointments:", err)
        toast.error("Failed to load patient's appointments.")
        setPatientAllAppointments([])
      } finally {
        setPatientAppointmentsLoading(false)
      }
    },
    [],
  )

  // New: Open modal for patient's appointments
  const openPatientAppointmentsModal = async (patient: PatientInfo) => {
    console.log('Opening modal for patient:', patient);
    setSelectedPatientForAppointments(patient)
    setPatientAppointmentsModalOpen(true)
    await fetchAllAppointmentsForPatient(patient.uhid)
  }

  // New: Close modal for patient's appointments
  const closePatientAppointmentsModal = () => {
    setPatientAppointmentsModalOpen(false)
    setSelectedPatientForAppointments(null)
    setPatientAllAppointments([])
  }

  const getBadgeColor = (t: string) => {
    switch (t) {
      case "OPD":
        return "bg-sky-100 text-sky-800"
      case "IPD":
        return "bg-orange-100 text-orange-800"
      case "OT":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getFilterTitle = () => {
    // Use filters directly for filterType, and currentDateRange for display dates
    const { filterType } = filters
    const { displayStart, displayEnd } = currentDateRange

    switch (filterType) {
      case "today":
        // Display today's date
        return `Today's Data (${format(parseISO(displayStart), "MMM dd, yyyy")})`
      case "month":
        // filters.selectedMonth is 'YYYY-MM', parse it as a date for formatting
        return `${format(parseISO(filters.selectedMonth + "-01"), "MMMM yyyy")} Data`
      case "dateRange":
        if (!filters.startDate || !filters.endDate) return "Select date range"
        // filters.startDate/endDate are already YYYY-MM-DD local strings
        return `${format(parseISO(filters.startDate), "MMM dd")} - ${format(parseISO(filters.endDate), "MMM dd, yyyy")}`
      case "week":
      default:
        // displayStart/displayEnd are already YYYY-MM-DD local strings from calculation
        return `Week: ${format(parseISO(displayStart), "MMM dd")} - ${format(parseISO(displayEnd), "MMM dd, yyyy")}`
    }
  }

  const getModalitiesSummary = (mods: IModality[]) => {
    const counts = {
      consultation: mods.filter((m) => m.type === "consultation").length,
      casualty: mods.filter((m) => m.type === "casualty").length,
      xray: mods.filter((m) => m.type === "xray").length,
      custom: mods.filter((m) => m.type === "custom").length,
      pathology: mods.filter((m) => m.type === "pathology").length,
      radiology: mods.filter((m) => m.type === "radiology").length,
      ipd: mods.filter((m) => m.type === "ipd").length,
    }
    const parts: string[] = []
    if (counts.consultation) parts.push(`${counts.consultation} Consultation${counts.consultation > 1 ? "s" : ""}`)
    if (counts.casualty) parts.push(`${counts.casualty} Casualty`)
    if (counts.xray) parts.push(`${counts.xray} X-ray${counts.xray > 1 ? "s" : ""}`)
    if (counts.pathology) parts.push(`${counts.pathology} Pathology`)
    if (counts.radiology) parts.push(`${counts.radiology} Radiology`)
    if (counts.ipd) parts.push(`${counts.ipd} IPD Service${counts.ipd > 1 ? "s" : ""}`)
    if (counts.custom) parts.push(`${counts.custom} Custom Service${counts.custom > 1 ? "s" : ""}`)
    return parts.join(", ") || "No services"
  }

  const today = new Date()
  const currentMonthStart = startOfMonth(today)
  const currentMonthEnd = endOfMonth(today)
  const currentYearStart = startOfYear(today)
  const currentYearEnd = endOfYear(today)

  const [filterType, setFilterType] = useState<"month" | "year" | "custom">("month")
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date
    to?: Date
  } | undefined>(undefined)

  useEffect(() => {
    if (filterType === "custom" && !customDateRange) {
      setCustomDateRange({ from: today, to: today })
    } else if (filterType !== "custom" && customDateRange) {
      setCustomDateRange(undefined)
    }
  }, [filterType, customDateRange, today])

  const getDateRange = useMemo(() => {
    switch (filterType) {
      case "month":
        return { from: currentMonthStart, to: currentMonthEnd }
      case "year":
        return { from: currentYearStart, to: currentYearEnd }
      case "custom":
        return customDateRange
      default:
        return { from: currentMonthStart, to: currentMonthEnd }
    }
  }, [filterType, customDateRange, currentMonthStart, currentMonthEnd, currentYearStart, currentYearEnd])

  // Last 3 days chart
  const chartData = useMemo(() => {
    const { from, to } = getDateRange || {}

    if (!from || !to) {
      return {
        labels: [],
        datasets: [],
      }
    }

    let labels: string[] = []
    let dateKeys: string[] = []

    if (filterType === "month") {
      const weeks = eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 }) // Monday as start of week
      labels = weeks.map((week, index) => `Week ${index + 1}`)
      dateKeys = weeks.map((week) => format(week, "yyyy-MM-dd")) // Use start of week as key
    } else if (filterType === "year") {
      const months = eachMonthOfInterval({ start: from, end: to })
      labels = months.map((month) => format(month, "MMM"))
      dateKeys = months.map((month) => format(month, "yyyy-MM")) // Use year-month as key
    } else {
      // custom range or default to day view
      const days = eachDayOfInterval({ start: from, end: to })
      labels = days.map((day) => format(day, "MMM dd"))
      dateKeys = days.map((day) => format(day, "yyyy-MM-dd"))
    }

    const initialCounts: Record<string, number> = Object.fromEntries(dateKeys.map((key) => [key, 0]))

    const opdCounts: Record<string, number> = { ...initialCounts }
    opdAppointments.forEach((a) => {
      const date = parseISO(a.created_at)
      let key: string
      if (filterType === "month") {
        key = format(eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 }).find(week => date >= week && date <= addDays(week, 6)) || from, "yyyy-MM-dd")
      } else if (filterType === "year") {
        key = format(date, "yyyy-MM")
      } else {
        key = format(date, "yyyy-MM-dd")
      }
      if (opdCounts[key] !== undefined) opdCounts[key]++
    })

    const ipdCounts: Record<string, number> = { ...initialCounts }
    ipdAppointments.forEach((a) => {
      const date = parseISO(a.created_at)
      let key: string
      if (filterType === "month") {
        key = format(eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 }).find(week => date >= week && date <= addDays(week, 6)) || from, "yyyy-MM-dd")
      } else if (filterType === "year") {
        key = format(date, "yyyy-MM")
      } else {
        key = format(date, "yyyy-MM-dd")
      }
      if (ipdCounts[key] !== undefined) ipdCounts[key]++
    })

    return {
      labels,
      datasets: [
        {
          label: "OPD Appointments",
          data: dateKeys.map((key) => opdCounts[key]),
          backgroundColor: "rgba(54,162,235,0.6)",
        },
        {
          label: "IPD Admissions",
          data: dateKeys.map((key) => ipdCounts[key]),
          backgroundColor: "rgba(255,99,132,0.6)",
        },
      ],
    }
  }, [opdAppointments, ipdAppointments, getDateRange, filterType])

  return (
    <Layout>
      <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-[1600px] mx-auto">
          {/* Header & Search */}
          <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-lg">
            <div className="px-6 py-4 flex flex-col md:flex-row justify-between items-center">
              <div className="flex items-center mb-4 md:mb-0">
                <div className="p-2 bg-gradient-to-r from-sky-500 to-blue-600 rounded-lg mr-3 shadow-md">
                  <Activity className="text-white h-6 w-6" />
                </div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
                INFICARE HOSPITAL MANAGEMENT
                </h1>
              </div>
              <div className="relative w-full md:w-1/3">
                <Search className="absolute top-3 left-3 text-gray-400 h-5 w-5" />
                <Input
                  type="text"
                  placeholder="Search by name, phone, or UHID (min 3 chars)"
                  value={filters.searchQuery}
                  onChange={(e) => setFilters((p) => ({ ...p, searchQuery: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 transition shadow-sm"
                />
                {filters.searchQuery.length >= 3 && searchDownloadedBytes > 0 && (
                  <p className="absolute -bottom-5 right-0 text-xs text-gray-500">
                    Downloaded: {formatBytes(searchDownloadedBytes)}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="p-6">
            {/* Advanced Filters (Hidden when searching) */}
            {!filters.searchQuery && (
              <div className="bg-white rounded-xl shadow-lg mb-6 p-6 border border-gray-100">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center mb-4 lg:mb-0">
                    <Filter className="mr-2 h-5 w-5 text-sky-500" /> Advanced Filters
                  </h2>
                  <Button
                    onClick={resetFilters}
                    variant="outline"
                    className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center shadow-sm"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Reset All
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Quick Filters */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Quick Filters</label>
                    <div className="flex flex-wrap gap-2">
                      {["today", "week", "month"].map((mode) => {
                        const label = mode === "week" ? "This Week" : mode === "today" ? "Today" : "This Month"
                        return (
                          <Button
                            key={mode}
                            onClick={() =>
                              handleFilterChange({
                                filterType: mode as any,
                                ...(mode === "month" ? { selectedMonth: format(new Date(), "yyyy-MM") } : {}),
                              })
                            }
                            className={`px-3 py-2 rounded-lg text-sm font-medium ${
                              filters.filterType === mode
                                ? "bg-sky-600 text-white shadow-md"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {label}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                  {/* Month Filter */}
                  <div>
                    <label htmlFor="month" className="block text-sm font-medium text-gray-700 mb-1">
                      Filter by Month
                    </label>
                    <Input
                      type="month"
                      id="month"
                      value={filters.selectedMonth}
                      onChange={(e) => handleFilterChange({ selectedMonth: e.target.value, filterType: "month" })}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                    />
                  </div>
                  {/* Date Range Filter */}
                  <div>
                    <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                      Start Date
                    </label>
                    <Input
                      type="date"
                      id="startDate"
                      value={filters.startDate}
                      onChange={(e) => handleDateRangeChange(e.target.value, filters.endDate)}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                      End Date (Max 30 days)
                    </label>
                    <Input
                      type="date"
                      id="endDate"
                      value={filters.endDate}
                      onChange={(e) => handleDateRangeChange(filters.startDate, e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="showOnlyOpd"
                      checked={filters.showOnlyOpd}
                      onChange={(e) => handleFilterChange({ showOnlyOpd: e.target.checked, showOnlyIpd: false, showOnlyOt: false, showOnlyBabyBirth: false })}
                      className="h-4 w-4 text-sky-600 focus:ring-sky-500 border-gray-300 rounded"
                    />
                    <label htmlFor="showOnlyOpd" className="ml-2 text-sm font-medium text-gray-700">Show only OPD</label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="showOnlyIpd"
                      checked={filters.showOnlyIpd}
                      onChange={(e) => handleFilterChange({ showOnlyIpd: e.target.checked, showOnlyOpd: false, showOnlyOt: false, showOnlyBabyBirth: false })}
                      className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                    />
                    <label htmlFor="showOnlyIpd" className="ml-2 text-sm font-medium text-gray-700">Show only IPD</label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="showOnlyOt"
                      checked={filters.showOnlyOt}
                      onChange={(e) => handleFilterChange({ showOnlyOt: e.target.checked, showOnlyOpd: false, showOnlyIpd: false, showOnlyBabyBirth: false })}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <label htmlFor="showOnlyOt" className="ml-2 text-sm font-medium text-gray-700">Show only OT</label>
                  </div>
                  {/* <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="showOnlyBabyBirth"
                      name="showOnlyBabyBirth"
                      checked={filters.showOnlyBabyBirth}
                      onChange={handleFilterToggleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="showOnlyBabyBirth" className="ml-2 text-sm font-medium text-gray-700">Show only Baby Birth</label>
                  </div> */}
                </div>
                <div className="mt-4 p-3 bg-gradient-to-r from-sky-50 to-blue-50 rounded-lg border border-sky-200 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <CalendarDays className="mr-2 h-5 w-5 text-sky-600" />
                      <span className="text-sky-800 font-medium">{getFilterTitle()}</span>
                    </div>
                    {totalDownloadedBytes > 0 && (
                      <span className="text-xs text-gray-500">
                        Total Data Downloaded: <b>{formatBytes(totalDownloadedBytes)}</b>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Dashboard Statistics (Hidden when searching) */}
            {!filters.searchQuery && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                  {/* OPD */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-sky-100 to-blue-100 rounded-full shadow-md">
                        <Activity className="text-sky-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">OPD</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalOpdCount}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Revenue</span>
                      <span className="text-lg font-semibold text-sky-600">
                        {formatCurrency(statistics.totalOpdAmount)}
                      </span>
                    </div>
                  </Card>
                  {/* IPD */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-orange-100 to-red-100 rounded-full shadow-md">
                        <Layers className="text-orange-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">IPD</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalIpdCount}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Net Deposits</span>
                      <span className="text-lg font-semibold text-orange-600">
                        {formatCurrency(ipdTotals ? ipdTotals.cash_total + ipdTotals.online_total : 0)}
                      </span>
                    </div>
                    {statistics.overallIpdRefunds > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-gray-600">Total Refunds</span>
                        <span className="text-lg font-semibold text-blue-600">
                          {formatCurrency(statistics.overallIpdRefunds)}
                        </span>
                      </div>
                    )}
                    {/* Always show Total TPA IPD, even if 0 */}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-gray-600">Total TPA IPD</span>
                      <span className="text-lg font-semibold text-orange-600">
                        {statistics.totalTpaIpd}
                      </span>
                    </div>
                  </Card>
                  {/* OT */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-purple-100 to-pink-100 rounded-full shadow-md">
                        <Stethoscope className="text-purple-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">OT</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalOtCount}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Procedures</span>
                      <span className="text-lg font-semibold text-purple-600">{statistics.totalOtCount}</span>
                    </div>
                    {statistics.totalMajorOt > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-gray-600">Major OT</span>
                        <span className="text-lg font-semibold text-purple-600">
                          {statistics.totalMajorOt}
                        </span>
                      </div>
                    )}
                    {statistics.totalMinorOt > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-gray-600">Minor OT</span>
                        <span className="text-lg font-semibold text-purple-600">
                          {statistics.totalMinorOt}
                        </span>
                      </div>
                    )}
                  </Card>
                  {/* Baby Births Card */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-pink-100 to-rose-100 rounded-full shadow-md">
                        <Heart className="text-pink-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">Total Births</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalBabyBirths}</p>
                      </div>
                    </div>
                    {statistics.totalBirthsWithLabor > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-gray-600">With Labor</span>
                        <span className="text-lg font-semibold text-pink-600">
                          {statistics.totalBirthsWithLabor}
                        </span>
                      </div>
                    )}
                    {statistics.totalBirthsWithOt > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-gray-600">With OT</span>
                        <span className="text-lg font-semibold text-pink-600">
                          {statistics.totalBirthsWithOt}
                        </span>
                      </div>
                    )}
                  </Card>
                  {/* Total Discharges Card */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-emerald-100 to-green-100 rounded-full shadow-md">
                        <UserCheck className="text-emerald-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">Total Discharges</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalDischarges}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Patients Discharged</span>
                      <span className="text-lg font-semibold text-emerald-600">
                        {statistics.totalDischarges}
                      </span>
                    </div>
                  </Card>
                  {/* Total Pathology Card */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-red-100 to-pink-100 rounded-full shadow-md">
                        <Activity className="text-red-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">Total Pathology</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalPathology}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Lab Tests</span>
                      <span className="text-lg font-semibold text-red-600">
                        {statistics.totalPathology}
                      </span>
                    </div>
                  </Card>
                  {/* Total Dialysis Card */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-cyan-100 to-blue-100 rounded-full shadow-md">
                        <Heart className="text-cyan-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">Total Dialysis</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalDialysis}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Procedures</span>
                      <span className="text-lg font-semibold text-cyan-600">
                        {statistics.totalDialysis}
                      </span>
                    </div>
                  </Card>
                  {/* Total X-ray Card */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-yellow-100 to-orange-100 rounded-full shadow-md">
                        <X className="text-yellow-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">Total X-ray</p>
                        <p className="text-2xl font-bold text-gray-900">{statistics.totalXray}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Scans</span>
                      <span className="text-lg font-semibold text-yellow-600">
                        {statistics.totalXray}
                      </span>
                    </div>
                  </Card>
                  {/* Total Revenue */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100 hover:shadow-xl transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-gradient-to-r from-emerald-100 to-green-100 rounded-full shadow-md">
                        <DollarSign className="text-emerald-600 h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-sm">Total</p>
                        <p className="text-2xl font-bold text-gray-900">Revenue</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Amount</span>
                      <span className="text-lg font-semibold text-emerald-600">
                        {formatCurrency(statistics.totalRevenue)}
                      </span>
                    </div>
                  </Card>
                  {/* IPD Totals Card - REMOVED PER USER INSTRUCTION */}
                  {/* <Card className="p-6 shadow-lg border border-gray-100 flex flex-col items-center justify-center text-center transition-all duration-300 hover:shadow-xl hover:scale-105 min-h-[180px]">
                    <Layers className="h-10 w-10 text-orange-500 mb-3" />
                    <h3 className="text-xl font-semibold text-gray-800 mb-2">IPD Total Collections</h3>
                    {ipdTotals ? (
                      <div className="text-sm text-gray-600">
                        <p><strong>Cash:</strong> {formatCurrency(ipdTotals.cash_total)}</p>
                        <p><strong>Online:</strong> {formatCurrency(ipdTotals.online_total)}</p>
                        <p className="text-xs text-gray-500 mt-2">
                          (UPI: {formatCurrency(ipdTotals.online_upi_total)}, Card: {formatCurrency(ipdTotals.online_card_total)}, Netbanking: {formatCurrency(ipdTotals.online_netbanking_total)}, Cheque: {formatCurrency(ipdTotals.online_cheque_total)})
                        </p>
                      </div>
                    ) : (
                      <p className="text-gray-500">Loading IPD totals...</p>
                    )}
                  </Card> */}
                </div>
                {/* Payment Breakdown & Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Payment Breakdown */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                      <CreditCard className="mr-2 h-5 w-5" /> Payment Breakdown
                    </h2>
                    <div className="space-y-6">
                      <div className="bg-gradient-to-r from-sky-50 to-blue-50 rounded-lg p-4 shadow-sm">
                        <h3 className="font-medium text-sky-800 mb-3">OPD Payments</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 text-sm">💵 Cash</span>
                            <span className="font-semibold text-sky-600">{formatCurrency(statistics.opdCash)}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 text-sm">💳 Online</span>
                            <span className="font-semibold text-sky-600">{formatCurrency(statistics.opdOnline)}</span>
                          </div>
                          <div className="flex justify-between items-center pt-2 border-t border-sky-200">
                            <span className="text-sky-700 font-medium">Total OPD</span>
                            <span className="font-bold text-sky-700">{formatCurrency(statistics.totalOpdAmount)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gradient-to-r from-orange-50 to-red-50 rounded-lg p-4 shadow-sm">
                        <h3 className="font-medium text-orange-800 mb-3">IPD Payments</h3>
                        {ipdTotals ? (
                          <div className="mt-4 pt-4 border-t border-orange-200">
                            <h4 className="font-semibold text-gray-800 mb-2">Total Collections (All Time)</h4>
                            <div className="text-sm text-gray-600 space-y-1">
                              <div className="flex justify-between items-center">
                                <span>Cash Total:</span>
                                <span className="font-semibold">{formatCurrency(ipdTotals.cash_total)}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span>Online Total:</span>
                                <span className="font-semibold">{formatCurrency(ipdTotals.online_total)}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                (UPI: {formatCurrency(ipdTotals.online_upi_total)}, Card: {formatCurrency(ipdTotals.online_card_total)}, Netbanking: {formatCurrency(ipdTotals.online_netbanking_total)}, Cheque: {formatCurrency(ipdTotals.online_cheque_total)})
                              </p>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-orange-200 mt-4">
                              <span className="text-orange-700 font-medium">Net Deposit (Online + Cash):</span>
                              <span className="font-bold text-orange-700">
                                {formatCurrency(ipdTotals.cash_total + ipdTotals.online_total)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-gray-500 mt-4">Loading historical IPD totals...</p>
                        )}
                      </div>
                      <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-lg p-4 shadow-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-emerald-800 font-semibold">💰 Grand Total</span>
                          <span className="font-bold text-xl text-emerald-600">
                            {formatCurrency(statistics.totalRevenue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                  {/* Appointments Overview Chart */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center justify-between">
                      <div className="flex items-center">
                        <Activity className="mr-2 h-5 w-5 text-gray-600" /> Appointments Overview
                      </div>
                      <div className="flex items-center space-x-2">
                        <Select value={filterType} onValueChange={(value: "month" | "year" | "custom") => setFilterType(value)}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Select Filter" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="month">This Month</SelectItem>
                            <SelectItem value="year">This Year</SelectItem>
                            <SelectItem value="custom">Custom Date</SelectItem>
                          </SelectContent>
                        </Select>
                        {filterType === "custom" && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                id="date"
                                variant="outline"
                                className={cn(
                                  "w-[300px] justify-start text-left font-normal",
                                  !customDateRange && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {customDateRange?.from ? (
                                  customDateRange.to ? (
                                    `${format(customDateRange.from, "LLL dd, y")} - ${format(customDateRange.to, "LLL dd, y")}`
                                  ) : (
                                    format(customDateRange.from, "LLL dd, y")
                                  )
                                ) : (
                                  <span>Pick a date</span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={customDateRange?.from}
                                selected={customDateRange}
                                onSelect={(range) => {
                                  if (range?.from) {
                                    setCustomDateRange(range as { from: Date; to?: Date })
                                  } else {
                                    setCustomDateRange(undefined)
                                  }
                                }}
                                numberOfMonths={2}
                              />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </h2>
                    <Bar
                      data={chartData}
                      options={{
                        responsive: true,
                        plugins: { legend: { position: "top" } },
                        scales: {
                          y: { beginAtZero: true, ticks: { stepSize: 1 } },
                        },
                      }}
                    />
                  </Card>
                </div>
                {/* Doctor Consultations List & Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* List */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                      <UserCheck className="mr-2 h-5 w-5" /> Doctor Consultations
                    </h2>
                    {doctorConsultations.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Doctor Name
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Consultations
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {doctorConsultations.map((doc) => (
                              <tr key={doc.doctorName} className="hover:bg-gray-50">
                                <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {doc.doctorName}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">{doc.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 py-8">
                        <p>No consultation data for the selected period.</p>
                      </div>
                    )}
                  </Card>
                  {/* Chart */}
                  <Card className="bg-white shadow-lg rounded-xl p-6 border border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                      <UserCheck className="mr-2 h-5 w-5" /> Top Doctors by Consultations
                    </h2>
                    {doctorConsultChartData.labels.length > 0 ? (
                      <Bar
                        data={doctorConsultChartData}
                        options={{
                          responsive: true,
                          plugins: { legend: { position: "top" } },
                          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, },
                        }}
                      />
                    ) : (
                      <div className="text-center text-gray-500 py-8">
                        <p>No data to display chart for the selected period.</p>
                      </div>
                    )}
                  </Card>
                </div>
              </>
            )}
            {/* Appointments/Patients Table */}
            <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-100">
              <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-gray-100">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                  <FileText className="mr-2 h-5 w-5 text-gray-600" />{" "}
                  {filters.searchQuery ? "Patient Search Results" : "Appointments List"}
                </h2>
              </div>
              {isLoading ? (
                <div className="flex justify-center items-center p-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sky-500"></div>
                  <span className="ml-3 text-gray-600">Loading data...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {filters.searchQuery ? (
                          <>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              UHID
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Patient Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Phone
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Age / Gender
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Action
                            </th>
                          </>
                        ) : (
                          <>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Patient
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Contact
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Date & Time
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Type
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Services/Amount
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Action
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filters.searchQuery ? (
                        searchedPatients.length > 0 ? (
                          searchedPatients.map((patient) => (
                            <tr key={patient.uhid} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {patient.uhid}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="p-2 bg-gray-100 rounded-full mr-3">
                                    <User className="h-4 w-4 text-gray-600" />
                                  </div>
                                  <div>
                                    <div className="text-sm font-medium text-gray-900">{patient.name}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-500">{patient.phone}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{patient.age || "N/A"}</div>
                                <div className="text-xs text-gray-500">{patient.gender || "N/A"}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <Button
                                  onClick={() => openPatientAppointmentsModal(patient)}
                                  className="bg-sky-600 hover:bg-sky-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors shadow-sm"
                                >
                                  View Appointments
                                </Button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center">
                              <div className="flex flex-col items-center">
                                <FileText className="h-12 w-12 text-gray-300 mb-4" />
                                <p className="text-gray-500 text-lg">No patients found matching your search.</p>
                                <p className="text-gray-400 text-sm">Try a different name or phone number.</p>
                              </div>
                            </td>
                          </tr>
                        )
                      ) : filteredAppointments.length > 0 ? (
                        filteredAppointments.map((app) => (
                          <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="p-2 bg-gray-100 rounded-full mr-3">
                                  <User className="h-4 w-4 text-gray-600" />
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-900">{app.name}</div>
                                  <div className="text-xs text-gray-500">UHID: {app.patientId}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500">{app.phone}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {format(
                                  parseISO(app.type === "OPD" || app.type === "OT" ? app.date : app.admission_date),
                                  "dd MMM, yyyy",
                                )}
                              </div>
                              <div className="text-xs text-gray-500 flex items-center">
                                <Clock className="h-3 w-3 mr-1" />
                                {app.type === "OPD" || app.type === "OT" ? app.time : app.admission_time}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getBadgeColor(app.type)}`}>
                                {app.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {app.type === "OPD" && (
                                <div>
                                  <div className="text-sm text-gray-600 mb-1">
                                    {getModalitiesSummary((app as OPDAppointmentDisplay).modalities)}
                                  </div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {formatCurrency((app as OPDAppointmentDisplay).payment.totalPaid)}
                                  </div>
                                </div>
                              )}
                              {app.type === "IPD" && (
                                <div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {formatCurrency((app as IPDAppointmentDisplay).totalDeposit)}
                                  </div>
                                  {((app as IPDAppointmentDisplay).remainingAmount ?? 0) > 0 && (
                                    <div className="text-xs text-red-500">
                                      Pending: {formatCurrency((app as IPDAppointmentDisplay).remainingAmount!)}
                                    </div>
                                  )}
                                </div>
                              )}
                              {app.type === "OT" && (
                                <div className="text-sm text-gray-500">
                                  Procedure: {(app as OTAppointmentDisplay).ot_type}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <Button
                                onClick={() => openModal(app)}
                                className="bg-sky-600 hover:bg-sky-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors shadow-sm"
                              >
                                View Details
                              </Button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <div className="flex flex-col items-center">
                              <FileText className="h-12 w-12 text-gray-300 mb-4" />
                              <p className="text-gray-500 text-lg">No appointments found</p>
                              <p className="text-gray-400 text-sm">Try adjusting your filters</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Appointment Details Modal */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold mb-6 flex items-center">
                <div
                  className={`p-3 rounded-full mr-4 shadow-md ${
                    selectedAppointment?.type === "OPD"
                      ? "bg-gradient-to-r from-sky-100 to-blue-100"
                      : selectedAppointment?.type === "IPD"
                      ? "bg-gradient-to-r from-orange-100 to-red-100"
                      : "bg-gradient-to-r from-purple-100 to-pink-100"
                  }`}
                >
                  {selectedAppointment?.type === "OPD" && <Activity className="text-sky-600 h-6 w-6" />}
                  {selectedAppointment?.type === "IPD" && <Layers className="text-orange-600 h-6 w-6" />}
                  {selectedAppointment?.type === "OT" && <Stethoscope className="text-purple-600 h-6 w-6" />}
                </div>
                {selectedAppointment?.type} Appointment Details
              </DialogTitle>
              <DialogDescription className="sr-only">Patient ID: {selectedAppointment?.patientId}</DialogDescription>
            </DialogHeader>
            {modalLoading ? (
              <div className="flex justify-center items-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-sky-500"></div>
                <span className="ml-3 text-gray-600">Loading details...</span>
              </div>
            ) : (
              selectedAppointment && (
                <>
                  {/* Patient Info */}
                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-6 mb-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                      <User className="mr-2 h-5 w-5 text-gray-600" /> Patient Information
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm text-gray-500">Patient Name</p>
                          <p className="font-medium text-lg">{selectedAppointment.name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Phone</p>
                          <p className="font-medium">{selectedAppointment.phone}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Date</p>
                          <p className="font-medium">
                            {format(
                              parseISO(
                                selectedAppointment.type === "IPD"
                                  ? selectedAppointment.admission_date
                                  : selectedAppointment.date,
                              ),
                              "dd MMM, yyyy",
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm text-gray-500">UHID</p>
                          <p className="font-medium">{selectedAppointment.patientId}</p>
                        </div>
                        {selectedAppointment.type === "IPD" && (
                          <div>
                            <p className="text-sm text-gray-500">Room Type</p>
                            <p className="font-medium">{(selectedAppointment as IPDAppointmentDisplay).roomType}</p>
                          </div>
                        )}
                        {selectedAppointment.type === "OT" && (
                          <div>
                            <p className="text-sm text-gray-500">IPD ID (for OT)</p>
                            <p className="font-medium">{(selectedAppointment as OTAppointmentDisplay).ipd_id}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* OPD Details */}
                  {selectedAppointment.type === "OPD" && (
                    <div className="space-y-6">
                      <div className="bg-gradient-to-r from-sky-50 to-blue-50 rounded-lg p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-sky-800 mb-4">OPD Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm text-gray-500">Time</p>
                              <p className="font-medium">{(selectedAppointment as OPDAppointmentDisplay).time}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Appointment Type</p>
                              <p className="font-medium capitalize">
                                {(selectedAppointment as OPDAppointmentDisplay).appointment_type || 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Visit Type</p>
                              <p className="font-medium capitalize">
                                {(selectedAppointment as OPDAppointmentDisplay).visit_type || 'N/A'}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm text-gray-500">Payment Method</p>
                              <p className="font-medium capitalize">
                                {(selectedAppointment as OPDAppointmentDisplay).payment.paymentMethod}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Total Amount</p>
                              <p className="font-bold text-xl text-sky-600">
                                {formatCurrency((selectedAppointment as OPDAppointmentDisplay).payment.totalPaid)}
                              </p>
                            </div>
                            {(selectedAppointment as OPDAppointmentDisplay).payment.discount > 0 && (
                              <div>
                                <p className="text-sm text-gray-500">Discount</p>
                                <p className="font-medium text-red-600">
                                  {formatCurrency((selectedAppointment as OPDAppointmentDisplay).payment.discount)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        {(selectedAppointment as OPDAppointmentDisplay).additional_notes && (
                          <div className="mt-4 p-3 bg-white rounded-lg border border-sky-200 shadow-sm">
                            <p className="text-sm text-gray-500">Notes</p>
                            <p className="font-medium">
                              {(selectedAppointment as OPDAppointmentDisplay).additional_notes}
                            </p>
                          </div>
                        )}
                      </div>
                      {(selectedAppointment as OPDAppointmentDisplay).modalities.length > 0 && (
                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-6 shadow-sm">
                          <h3 className="text-lg font-semibold text-purple-800 mb-4 flex items-center">
                            <FileText className="mr-2 h-5 w-5" /> Services & Modalities
                          </h3>
                          <div className="space-y-3">
                            {(selectedAppointment as OPDAppointmentDisplay).modalities.map(
                              (m: IModality, i: number) => (
                                <div key={i} className="border border-purple-200 rounded p-3 bg-white shadow-sm">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium capitalize">
                                      {m.type}
                                    </span>
                                    <span className="font-semibold text-purple-700">₹{m.charges}</span>
                                  </div>
                                  {m.doctor && (
                                    <div className="text-xs text-gray-600">
                                      <strong>Doctor:</strong> {m.doctor}
                                    </div>
                                  )}
                                  {m.specialist && (
                                    <div className="text-xs text-gray-600">
                                      <strong>Specialist:</strong> {m.specialist}
                                    </div>
                                  )}
                                  {m.service && (
                                    <div className="text-xs text-gray-600">
                                      <strong>Service:</strong> {m.service}
                                    </div>
                                  )}
                                  {m.visitType && (
                                    <div className="text-xs text-gray-600">
                                      <strong>Visit Type:</strong> {m.visitType}
                                    </div>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                          <div className="mt-4 p-4 bg-white rounded-lg border border-purple-200 shadow-sm">
                            <div className="flex justify-between items-center text-lg font-semibold">
                              <span className="text-purple-700">Total Charges:</span>
                              <span className="text-purple-600">
                                ₹{(selectedAppointment as OPDAppointmentDisplay).payment.totalCharges}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-green-800 mb-4 flex items-center">
                          <CreditCard className="mr-2 h-5 w-5" /> Payment Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Cash Amount:</span>
                              <span className="font-semibold text-green-700">
                                ₹{(selectedAppointment as OPDAppointmentDisplay).payment.cashAmount}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Online Amount:</span>
                              <span className="font-semibold text-blue-700">
                                ₹{(selectedAppointment as OPDAppointmentDisplay).payment.onlineAmount}
                              </span>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Total Charges:</span>
                              <span className="font-semibold">
                                ₹{(selectedAppointment as OPDAppointmentDisplay).payment.totalCharges}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Discount:</span>
                              <span className="font-semibold text-red-600">
                                ₹{(selectedAppointment as OPDAppointmentDisplay).payment.discount}
                              </span>
                            </div>
                            <div className="flex justify-between border-t pt-2">
                              <span className="text-green-700 font-bold">Total Paid:</span>
                              <span className="font-bold text-green-600">
                                ₹{(selectedAppointment as OPDAppointmentDisplay).payment.totalPaid}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* IPD Details */}
                  {selectedAppointment.type === "IPD" && (
                    <div className="space-y-6">
                      {(selectedAppointment as IPDAppointmentDisplay).service_detail &&
                        (selectedAppointment as IPDAppointmentDisplay).service_detail!.length > 0 && (
                          <div className="bg-gradient-to-r from-orange-50 to-red-50 rounded-lg p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-orange-800 mb-4 flex items-center">
                              <FileText className="mr-2 h-5 w-5" /> Services & Charges
                            </h3>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-orange-200">
                                <thead className="bg-orange-100">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-orange-700 uppercase tracking-wider">
                                      Service
                                    </th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-orange-700 uppercase tracking-wider">
                                      Type
                                    </th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-orange-700 uppercase tracking-wider">
                                      Doctor
                                    </th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-orange-700 uppercase tracking-wider">
                                      Amount
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-orange-100">
                                  {(selectedAppointment as IPDAppointmentDisplay).service_detail!.map((s, i) => (
                                    <tr key={i} className="hover:bg-orange-50">
                                      <td className="px-4 py-2 text-sm text-gray-900">{s.serviceName}</td>
                                      <td className="px-4 py-2 text-sm text-gray-600 capitalize">{s.type}</td>
                                      <td className="px-4 py-2 text-sm text-gray-600">{s.doctorName || "-"}</td>
                                      <td className="px-4 py-2 text-sm font-medium text-orange-600">
                                        {formatCurrency(s.amount)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-4 p-4 bg-white rounded-lg border border-orange-200 shadow-sm">
                              <div className="flex justify-between items-center text-lg font-semibold">
                                <span className="text-orange-700">Total Service Amount:</span>
                                <span className="text-orange-600">
                                  {formatCurrency((selectedAppointment as IPDAppointmentDisplay).totalAmount)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      {(selectedAppointment as IPDAppointmentDisplay).payment_detail &&
                        (selectedAppointment as IPDAppointmentDisplay).payment_detail!.length > 0 && (
                          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-green-800 mb-4 flex items-center">
                              <CreditCard className="mr-2 h-5 w-5" /> Payment History
                            </h3>
                            <div className="space-y-3">
                              {(selectedAppointment as IPDAppointmentDisplay).payment_detail!.map((p, i) => (
                                <div
                                  key={p.id || i}
                                  className="flex justify-between items-center p-3 bg-white rounded-lg border border-green-200 shadow-sm"
                                >
                                  <div>
                                    <span className="font-medium text-green-700">
                                      {/* Safely access and uppercase paymentType, type, or transactionType */}
                                      {`${p.paymentType?.toUpperCase() || 'N/A'} - ${p.type?.toUpperCase() || p.transactionType?.toUpperCase() || 'N/A'}`}
                                    </span>
                                    {p.date && (
                                      <p className="text-sm text-gray-500">
                                        {format(parseISO(p.date), "dd MMM, yyyy")}
                                      </p>
                                    )}
                                  </div>
                                  <span className="font-bold text-green-600">{formatCurrency(p.amount)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 p-4 bg-white rounded-lg border border-green-200 shadow-sm">
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-green-700">Total Deposits:</span>
                                  <span className="font-bold text-green-600">
                                    {formatCurrency((selectedAppointment as IPDAppointmentDisplay).totalDeposit)}
                                  </span>
                                </div>
                                {(selectedAppointment as IPDAppointmentDisplay).totalRefunds > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Total Refunds:</span>
                                    <span className="font-bold text-red-600">
                                      {formatCurrency((selectedAppointment as IPDAppointmentDisplay).totalRefunds)}
                                    </span>
                                  </div>
                                )}
                                {(selectedAppointment as IPDAppointmentDisplay).discount > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Total Discount:</span>
                                    <span className="font-bold text-orange-600">
                                      {formatCurrency((selectedAppointment as IPDAppointmentDisplay).discount)}
                                    </span>
                                  </div>
                                )}
                                <div className="flex justify-between border-t pt-2">
                                  <span className="text-green-700 font-bold">Net Amount Paid:</span>
                                  <span className="font-bold text-green-600">
                                    {formatCurrency(
                                      (selectedAppointment as IPDAppointmentDisplay).totalDeposit -
                                        (selectedAppointment as IPDAppointmentDisplay).totalRefunds,
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      <div className="bg-gradient-to-r from-blue-50 to-sky-50 rounded-lg p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-blue-800 mb-4 flex items-center">
                          <DollarSign className="mr-2 h-5 w-5" /> Financial Summary
                        </h3>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Total Services:</span>
                            <span className="font-semibold text-blue-700">
                              {formatCurrency((selectedAppointment as IPDAppointmentDisplay).totalAmount)}
                            </span>
                          </div>
                          {(selectedAppointment as IPDAppointmentDisplay).discount > 0 && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600">Discount Applied:</span>
                              <span className="font-semibold text-red-600">
                                {formatCurrency((selectedAppointment as IPDAppointmentDisplay).discount)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Total Deposits:</span>
                            <span className="font-semibold text-green-700">
                              {formatCurrency((selectedAppointment as IPDAppointmentDisplay).totalDeposit)}
                            </span>
                          </div>
                          {(selectedAppointment as IPDAppointmentDisplay).totalRefunds > 0 && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600">Total Refunds Issued:</span>
                              <span className="font-semibold text-red-600">
                                {formatCurrency((selectedAppointment as IPDAppointmentDisplay).totalRefunds)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between items-center pt-3 border-t border-blue-200">
                            <span className="text-blue-800 font-bold text-lg">Net Balance:</span>
                            <span
                              className={`font-bold text-xl ${
                                (selectedAppointment as IPDAppointmentDisplay).remainingAmount! > 0
                                  ? "text-red-600"
                                  : (selectedAppointment as IPDAppointmentDisplay).remainingAmount! < 0
                                  ? "text-green-600"
                                  : "text-gray-800"
                              }`}
                            >
                              {formatCurrency((selectedAppointment as IPDAppointmentDisplay).remainingAmount!)}
                              {(selectedAppointment as IPDAppointmentDisplay).remainingAmount! > 0
                                ? " (Due)"
                                : (selectedAppointment as IPDAppointmentDisplay).remainingAmount! < 0
                                ? " (Refundable)"
                                : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                      {selectedAppointment.type === "IPD" && (selectedAppointment as IPDAppointmentDisplay).ipd_notes && (
                        <div className="mt-4 p-3 bg-white rounded-lg border border-orange-200 shadow-sm">
                          <p className="text-sm text-gray-500">IPD Note</p>
                          <p className="font-medium">{(selectedAppointment as IPDAppointmentDisplay).ipd_notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {/* OT Details */}
                  {selectedAppointment.type === "OT" && (
                    <div className="space-y-6">
                      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-purple-800 mb-4 flex items-center">
                          <Stethoscope className="mr-2 h-5 w-5" /> OT Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm text-gray-500">OT Type</p>
                              <p className="font-medium capitalize">
                                {(selectedAppointment as OTAppointmentDisplay).ot_type}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">OT Date</p>
                              <p className="font-medium">
                                {format(
                                  parseISO((selectedAppointment as OTAppointmentDisplay).ot_date),
                                  "dd MMM, yyyy",
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Time</p>
                              <p className="font-medium">
                                {(selectedAppointment as OTAppointmentDisplay).time}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm text-gray-500">Notes</p>
                              <p className="font-medium">
                                {(selectedAppointment as OTAppointmentDisplay).ot_notes || 'No notes'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {(selectedAppointment as OTAppointmentDisplay).has_baby_birth && (
                          <div className="mt-6 p-4 bg-teal-50 rounded-lg border border-teal-200 shadow-inner">
                            <h4 className="text-md font-semibold text-teal-800 mb-3 flex items-center">
                              <User className="mr-2 h-4 w-4" /> Baby Birth Details
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-gray-600">Birth Date:</p>
                                <p className="font-medium text-gray-900">
                                  {((selectedAppointment as OTAppointmentDisplay).baby_birth_date &&
                                    format(parseISO((selectedAppointment as OTAppointmentDisplay).baby_birth_date!), 'dd MMM, yyyy')) || 'N/A'}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-600">Weight:</p>
                                <p className="font-medium text-gray-900">
                                  {((selectedAppointment as OTAppointmentDisplay).baby_birth_weight !== null &&
                                    `${(selectedAppointment as OTAppointmentDisplay).baby_birth_weight} kg`) || 'N/A'}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-600">Gender:</p>
                                <p className="font-medium text-gray-900">
                                  {((selectedAppointment as OTAppointmentDisplay).baby_birth_gender) || 'N/A'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )
            )}
          </DialogContent>
        </Dialog>
        {/* New: Patient Appointments Details Modal */}
        <Dialog open={patientAppointmentsModalOpen} onOpenChange={closePatientAppointmentsModal}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold mb-6 flex items-center">
                <User className="p-2 rounded-full mr-4 bg-gradient-to-r from-sky-100 to-blue-100 text-sky-600 h-10 w-10 shadow-md" />
                <span>
                  Appointments for {selectedPatientForAppointments?.name} (UHID:{" "}
                  {selectedPatientForAppointments?.uhid})
                </span>
              </DialogTitle>
              <DialogDescription>All recorded appointments for this patient.</DialogDescription>
            </DialogHeader>
            {patientAppointmentsLoading ? (
              <div className="flex justify-center items-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-sky-500"></div>
                <span className="ml-3 text-gray-600">Loading patient appointments...</span>
              </div>
            ) : (
              <>
                {patientAllAppointments.length > 0 ? (
                  <div className="space-y-4">
                    {patientAllAppointments.map((app) => (
                      <div key={app.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${getBadgeColor(app.type)}`}>
                            {app.type}
                          </span>
                          <span className="text-sm text-gray-600">
                            {format(parseISO(app.type === "IPD" ? app.admission_date : app.date), "dd MMM, yyyy")}{" "}
                            {" at "}
                            {app.type === "OPD" || app.type === "OT" ? app.time : app.admission_time}
                          </span>
                        </div>
                        <p className="text-lg font-semibold text-gray-900">
                          {app.type === "OPD" &&
                            `OPD Visit - ${getModalitiesSummary((app as OPDAppointmentDisplay).modalities)}`}
                          {app.type === "IPD" &&
                            `IPD Admission - ${formatCurrency((app as IPDAppointmentDisplay).totalAmount)}`}
                          {app.type === "OT" && `OT Procedure - ${(app as OTAppointmentDisplay).ot_type}`}
                        </p>
                        {app.type === "OPD" && (
                          <p className="text-sm text-gray-700">
                            Total Paid: {formatCurrency((app as OPDAppointmentDisplay).payment.totalPaid)}
                          </p>
                        )}
                        {app.type === "IPD" && (
                          <p className="text-sm text-gray-700">
                            Net Deposit: {formatCurrency((app as IPDAppointmentDisplay).totalDeposit)}
                          </p>
                        )}
                        <Button
                          onClick={() => openModal(app)}
                          className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors shadow-sm"
                        >
                          View Full Details
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    <p>No appointments found for this patient.</p>
                  </div>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </Layout>
  )
}

export default DashboardPage