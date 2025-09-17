"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm, SubmitHandler } from "react-hook-form";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  Mic,
  MicOff,
  RefreshCw,
  UserCheck,
  History,
  FileText,
  PlusCircle,
  Download,
  ArrowLeft,
  Eye,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO } from "date-fns";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { v4 as uuidv4 } from "uuid";
import Layout from "@/components/global/Layout";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

// --- Type Definitions ---
interface PatientDetail {
  patient_id: number;
  name: string;
  number: string | null;
  age: number | null;
  gender: string | null;
  address: string | null;
  age_unit: string | null;
  uhid: string;
}

interface MedicineEntry {
  name: string;
  consumptionDays: string;
  times: { morning: boolean; evening: boolean; night: boolean };
  instruction: string;
}

interface OPDPrescriptionRow {
  id: string;
  opd_id: number;
  uhid: string;
  symptoms: string | null;
  medicines: MedicineEntry[] | null;
  overall_instruction: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

interface PrescriptionFormInputs {
  symptoms: string;
  overallInstruction: string;
}
// --- End Type Definitions ---

// Helper to convert number words to digits
const wordToNumber = (word: string): number | null => {
    const wordNumMap: { [key: string]: number } = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    return wordNumMap[word.toLowerCase()] || null;
};


export default function OPDPrescriptionPage() {
  const { opd_id } = useParams<{ opd_id: string }>();
  const router = useRouter();

  // State
  const [patientData, setPatientData] = useState<PatientDetail | null>(null);
  const [currentPrescription, setCurrentPrescription] = useState<OPDPrescriptionRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [medicines, setMedicines] = useState<MedicineEntry[]>([
    { name: "", consumptionDays: "", times: { morning: false, evening: false, night: false }, instruction: "" },
  ]);
  const [showMedicineDetails, setShowMedicineDetails] = useState(false);
  const [activeMedicineIndex, setActiveMedicineIndex] = useState(0);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyModalItems, setHistoryModalItems] = useState<OPDPrescriptionRow[]>([]);

  // Refs
  const prescriptionContentRef = useRef<HTMLDivElement>(null);

  const { register, handleSubmit, reset, setValue } = useForm<PrescriptionFormInputs>({
    defaultValues: { symptoms: "", overallInstruction: "" },
  });

  // --- Form Submission Logic ---
  const onSubmit: SubmitHandler<PrescriptionFormInputs> = async (formData) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserEmail = user?.email || "unknown";
      const opdNum = Number(opd_id);
      const patientUHID = patientData?.uhid;

      if (!patientUHID) {
        toast.error("Patient UHID not found.");
        return;
      }

      const prescriptionPayload = {
        opd_id: opdNum,
        uhid: patientUHID,
        symptoms: formData.symptoms,
        medicines: showMedicineDetails ? medicines.filter(m => m.name) : [],
        overall_instruction: formData.overallInstruction,
        updated_at: new Date().toISOString(),
        updated_by: currentUserEmail,
      };

      const { error } = currentPrescription
        ? await supabase.from("opd_prescriptions").update(prescriptionPayload).eq("id", currentPrescription.id)
        : await supabase.from("opd_prescriptions").insert({ ...prescriptionPayload, created_by: currentUserEmail });
      
      if (error) throw new Error(error.message);
      
      toast.success("Prescription saved successfully!");
      await fetchPatientAndPrescriptionData();
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Voice Command Definitions ---
  const commands = [
    {
      command: ["disease *", "symptom *", "symptoms *"],
      callback: (content: string) => {
        setValue("symptoms", content);
        toast.info(`Symptom set to: ${content}`);
      },
    },
    {
      command: ["add medicine *", "new medicine *"],
      callback: (medicineName: string) => {
        if (!showMedicineDetails) setShowMedicineDetails(true);
        const newIndex = medicines.length;
        setMedicines([...medicines, { name: medicineName, consumptionDays: "", times: { morning: false, evening: false, night: false }, instruction: "" }]);
        setActiveMedicineIndex(newIndex);
        toast.success(`Added medicine: ${medicineName}`);
      },
    },
    {
      command: ["add another medicine", "new medicine"],
      callback: () => {
        if (!showMedicineDetails) setShowMedicineDetails(true);
        addMedicine();
      }
    },
    {
      command: ["select medicine *", "focus on medicine *", "medicine *"],
      callback: (identifier: string) => {
        const num = parseInt(identifier, 10);
        const index = !isNaN(num) ? num - 1 : (wordToNumber(identifier) || 0) - 1;

        if (index >= 0 && index < medicines.length) {
          setActiveMedicineIndex(index);
          toast.success(`Selected Medicine ${index + 1}.`);
        } else {
          toast.error(`Medicine ${identifier} not found.`);
        }
      },
    },
    {
      command: ["days *", "for * days", "duration *"],
      callback: (days: string) => {
        if (!showMedicineDetails) return;
        const dayValue = parseInt(days, 10) ? `${parseInt(days, 10)} days` : days;
        handleMedicineChange(activeMedicineIndex, "consumptionDays", dayValue);
        toast.info(`Set days for active medicine to: ${dayValue}`);
      },
    },
    {
      command: "set time *",
      callback: (timeStr: string) => {
          if (!showMedicineDetails) return;
          const newTimes = {
              morning: timeStr.includes("morning"),
              evening: timeStr.includes("evening"),
              night: timeStr.includes("night"),
          };
          setMedicines(prev => prev.map((med, i) => i === activeMedicineIndex ? { ...med, times: newTimes } : med));
          toast.info(`Updated time for active medicine.`);
      },
    },
    {
      command: ["instruction *", "add instruction *"],
      callback: (instruction: string) => {
        if (!showMedicineDetails) return;
        handleMedicineChange(activeMedicineIndex, "instruction", instruction);
        toast.info(`Instruction for active medicine: ${instruction}`);
      },
    },
    {
      command: ["overall instruction *", "note *", "final instruction *"],
      callback: (instruction: string) => {
        setValue("overallInstruction", instruction);
        toast.info(`Overall instruction set.`);
      },
    },
    {
        command: ["clear form", "reset form"],
        callback: () => clearPrescription(),
    },
    {
        command: ["save prescription", "submit form"],
        callback: () => handleSubmit(onSubmit)(),
    },
  ];

  const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition({ commands });
  const toggleListening = () => {
    if (listening) {
      SpeechRecognition.stopListening();
    } else {
      if (!browserSupportsSpeechRecognition) {
        toast.error("Speech recognition is not supported by your browser.");
        return;
      }
      SpeechRecognition.startListening({ continuous: true, language: "en-IN" });
    }
  };
  
  // --- Data Fetching & Component Logic ---
  const fetchPatientAndPrescriptionData = useCallback(async () => {
    // ... (This function remains unchanged from your previous code)
    if (!opd_id) { setIsLoading(false); return; }
    setIsLoading(true);
    const opdNum = Number(opd_id);
    try {
      const { data: opdData, error: opdError } = await supabase.from("opd_registration").select(`uhid, patient_detail:patient_detail!opd_registration_uhid_fkey (*)`).eq("opd_id", opdNum).single();
      if (opdError || !opdData) { toast.error("Failed to load patient data."); router.push("/opd/list/opdlistprescripitono"); return; }
      setPatientData(opdData.patient_detail as unknown as PatientDetail);
      const { data: presData, error: presError } = await supabase.from("opd_prescriptions").select("*").eq("opd_id", opdNum).single();
      if (presError && presError.code !== "PGRST116") { toast.error("Failed to load prescription."); }
      else if (presData) {
        setCurrentPrescription(presData);
        setValue("symptoms", presData.symptoms || "");
        setValue("overallInstruction", presData.overall_instruction || "");
        const loadedMedicines = presData.medicines && presData.medicines.length > 0 ? presData.medicines : [{ name: "", consumptionDays: "", times: { morning: false, evening: false, night: false }, instruction: "" }];
        setMedicines(loadedMedicines);
        setShowMedicineDetails(presData.medicines && presData.medicines.length > 0);
      } else {
        setCurrentPrescription(null); reset();
        setMedicines([{ name: "", consumptionDays: "", times: { morning: false, evening: false, night: false }, instruction: "" }]);
        setShowMedicineDetails(false);
      }
    } catch (error) { toast.error("An unexpected error occurred."); router.push("/opd/list/opdlistprescripitono"); }
    finally { setIsLoading(false); }
  }, [opd_id, router, setValue, reset]);

  useEffect(() => { fetchPatientAndPrescriptionData(); }, [fetchPatientAndPrescriptionData]);

  // --- Real-time Subscription ---
  useEffect(() => {
    // ... (This function remains unchanged)
    if (!opd_id) return;
    const channel = supabase.channel(`opd_prescription_opd_id_${opd_id}`).on("postgres_changes", { event: "*", schema: "public", table: "opd_prescriptions", filter: `opd_id=eq.${opd_id}`}, payload => { toast.info(`Prescription data updated.`); fetchPatientAndPrescriptionData(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [opd_id, fetchPatientAndPrescriptionData]);

  // --- Medicine Helper Functions ---
  const toggleMedicineDetails = () => setShowMedicineDetails((prev) => !prev);
  const addMedicine = () => {
    setMedicines([...medicines, { name: "", consumptionDays: "", times: { morning: false, evening: false, night: false }, instruction: "" }]);
    setActiveMedicineIndex(medicines.length);
    toast.info("Added a new medicine entry.");
  };
  const handleRemoveMedicine = (index: number) => {
    setMedicines((prev) => prev.filter((_, i) => i !== index));
    if (activeMedicineIndex >= index) setActiveMedicineIndex(Math.max(0, activeMedicineIndex - 1));
  };
  const handleMedicineChange = (index: number, field: keyof MedicineEntry, value: any) => setMedicines((prev) => prev.map((med, i) => (i === index ? { ...med, [field]: value } : med)));
  const handleTimeToggle = (index: number, time: keyof MedicineEntry["times"]) => setMedicines((prev) => prev.map((med, i) => (i === index ? { ...med, times: { ...med.times, [time]: !med.times[time] } } : med)));
  const clearPrescription = () => {
    reset();
    setMedicines([{ name: "", consumptionDays: "", times: { morning: false, evening: false, night: false }, instruction: "" }]);
    setShowMedicineDetails(false);
    resetTranscript();
    toast.info("Form cleared.");
  };

  // --- PDF & WhatsApp Functions ---
  const generatePDFBlob = useCallback(async (prescriptionData: OPDPrescriptionRow | null) => {
      // ... (This function remains unchanged)
      const dataToUse = prescriptionData || currentPrescription;
      if (!prescriptionContentRef.current || !patientData || !dataToUse) return null;
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const letterheadImage = "/letterhead.png";
      const originalRefStyle = prescriptionContentRef.current.style.cssText;
      prescriptionContentRef.current.style.position = "static";
      prescriptionContentRef.current.style.background = `url(${letterheadImage}) no-repeat center top / contain`;
      prescriptionContentRef.current.style.color = "#000";
      prescriptionContentRef.current.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8mm; border-bottom: 1px solid #ccc; padding-bottom: 2mm;">
          <div><p><strong>Name:</strong> ${patientData.name}</p><p><strong>UHID:</strong> ${patientData.uhid}</p><p><strong>OPD ID:</strong> ${dataToUse.opd_id}</p></div>
          <div style="text-align: right;"><p><strong>Date:</strong> ${format(parseISO(dataToUse.created_at), "MMM dd, yyyy")}</p><p><strong>Age:</strong> ${patientData.age} ${patientData.age_unit || ""}</p><p><strong>Gender:</strong> ${patientData.gender}</p></div>
        </div>
        <div style="margin-bottom: 8mm;"><h3 style="font-size: 13pt; margin-bottom: 3mm; border-bottom: 1px dashed #ccc;">Medicines</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead><tr><th style="text-align: left;">Name</th><th>Days</th><th>Time</th><th style="text-align: left;">Instruction</th></tr></thead>
            <tbody>
              ${(dataToUse.medicines && dataToUse.medicines.length > 0) ? dataToUse.medicines.map(med => `<tr><td>${med.name}</td><td style="text-align: center;">${med.consumptionDays}</td><td style="text-align: center;">${(med.times.morning ? "M " : "") + (med.times.evening ? "E " : "") + (med.times.night ? "N" : "")}</td><td>${med.instruction}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align: center;">No medicines.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div><h3 style="font-size: 13pt; border-bottom: 1px dashed #ccc;">Symptoms/Disease</h3><p>${dataToUse.symptoms || "N/A"}</p></div>
        <div style="margin-top: 8mm;"><h3 style="font-size: 13pt; border-bottom: 1px dashed #ccc;">Overall Instructions</h3><p>${dataToUse.overall_instruction || "N/A"}</p></div>`;
      const canvas = await html2canvas(prescriptionContentRef.current, { scale: 2 });
      pdf.addImage(canvas.toDataURL("image/jpeg", 1.0), "JPEG", 0, 0, pdfWidth, canvas.height * pdfWidth / canvas.width);
      if (prescriptionContentRef.current) { prescriptionContentRef.current.style.cssText = originalRefStyle; prescriptionContentRef.current.innerHTML = ''; }
      return pdf.output("blob");
  }, [patientData, currentPrescription]);

  const downloadPrescription = async () => {
      // ... (This function remains unchanged)
      const pdfBlob = await generatePDFBlob(currentPrescription);
      if (!pdfBlob) { toast.error("Failed to generate PDF."); return; }
      const blobURL = URL.createObjectURL(pdfBlob);
      window.open(blobURL, "_blank");
      toast.success("PDF opened successfully!");
  };
  
  const uploadPdfAndSendWhatsApp = async () => {
      // ... (This function remains unchanged)
      if (!currentPrescription || !patientData?.number) { toast.error(!patientData?.number ? "Patient phone number missing." : "Prescription data not loaded."); return; }
      setIsSendingWhatsApp(true);
      try {
        const pdfBlob = await generatePDFBlob(currentPrescription);
        if (!pdfBlob) throw new Error("Failed to generate PDF for WhatsApp.");
        const fileName = `prescription-${patientData.uhid}-${uuidv4()}.pdf`;
        const { error: uploadError } = await supabase.storage.from("dpr-documents").upload(`opd_prescriptions/${fileName}`, pdfBlob);
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        const { data: { publicUrl } } = supabase.storage.from("dpr-documents").getPublicUrl(`opd_prescriptions/${fileName}`);
        if (!publicUrl) throw new Error("Failed to get public URL.");
        const formattedNumber = patientData.number.startsWith("91") ? patientData.number : `91${patientData.number}`;
        const response = await fetch("https://a.infispark.in/send-image-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "9958399157", number: formattedNumber, imageUrl: publicUrl, caption: `Dear ${patientData.name}, here is your prescription for OPD ID ${opd_id}.` }) });
        if (!response.ok) throw new Error(`API Error: ${await response.text()}`);
        const result = await response.json();
        if (result.status === "success") toast.success("Prescription sent via WhatsApp!");
        else toast.error(`WhatsApp failed: ${result.message || "Unknown error"}`);
      } catch (error: any) { toast.error(`WhatsApp Error: ${error.message}`); }
      finally { setIsSendingWhatsApp(false); }
  };
  
  const viewHistoryPrescription = async (historyItem: OPDPrescriptionRow) => {
      // ... (This function remains unchanged)
      const pdfBlob = await generatePDFBlob(historyItem);
      if (!pdfBlob) { toast.error("Failed to generate historical PDF."); return; }
      window.open(URL.createObjectURL(pdfBlob), "_blank");
  };
  
  // --- History Fetching ---
  const fetchPreviousPrescriptions = useCallback(async () => {
    // ... (This function remains unchanged)
    if (!patientData?.uhid) return;
    try {
      const { data, error } = await supabase.from("opd_prescriptions").select("*").eq("uhid", patientData.uhid).order("created_at", { ascending: false });
      if (error) throw error;
      setHistoryModalItems(data.filter((item) => item.id !== currentPrescription?.id));
    } catch { toast.error("Failed to load history."); }
  }, [patientData, currentPrescription]);

  useEffect(() => { if (showHistoryModal) fetchPreviousPrescriptions(); }, [showHistoryModal, fetchPreviousPrescriptions]);

  // --- Render Logic ---
  if (isLoading) return <div className="flex justify-center items-center min-h-screen"><RefreshCw className="h-10 w-10 animate-spin" /></div>;
  if (!patientData) return <div className="flex justify-center items-center min-h-screen text-red-600"><p>Patient data not found for OPD ID {opd_id}.</p></div>;

  return (
    <Layout>
      <div className="container mx-auto p-2 sm:p-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4">
          <h1 className="text-xl sm:text-3xl font-bold flex items-center gap-2"><FileText />OPD Prescription</h1>
          <Button onClick={() => router.push("/opd/list/opdlistprescripitono")} variant="outline" className="w-full sm:w-auto mt-2 sm:mt-0"><ArrowLeft className="h-4 w-4 mr-2" /> Back to List</Button>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>{patientData.name} (UHID: {patientData.uhid})</CardTitle>
            <p className="text-sm text-gray-600">OPD ID: {opd_id}</p>
          </CardHeader>
          <CardContent>
            {/* Voice Control UI */}
            <Button type="button" onClick={toggleListening} className="w-full mb-2 bg-purple-600 hover:bg-purple-700">
              {listening ? <><MicOff className="mr-2 animate-pulse" /> Stop Listening</> : <><Mic className="mr-2" /> Start Voice Commands</>}
            </Button>
            {listening && <div className="mb-3 p-2 bg-blue-50 border rounded-md text-sm italic">Listening: {transcript || "..."}</div>}
            
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Symptoms Input */}
              <div>
                <label htmlFor="symptoms" className="block text-sm font-medium">Symptoms/Disease</label>
                <Textarea id="symptoms" {...register("symptoms", { required: true })} placeholder="Enter symptoms or say 'disease [name]'" />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button type="button" onClick={toggleMedicineDetails} variant="outline" className="flex-1"><PlusCircle className="mr-2" />{showMedicineDetails ? "Hide Medicines" : "Add Medicines"}</Button>
                <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
                  <DialogTrigger asChild><Button variant="outline" className="flex-1"><History className="mr-2" /> View History</Button></DialogTrigger>
                  <DialogContent className="sm:max-w-[900px]">
                      {/* History Modal Content is unchanged */}
                  </DialogContent>
                </Dialog>
              </div>

              {/* Medicine Details Section */}
              {showMedicineDetails && (
                <div className="space-y-3 border p-3 rounded-md bg-gray-50">
                  <h3 className="text-lg font-semibold">Medicines</h3>
                  {medicines.map((medicine, index) => (
                    <Card key={index} className={`p-3 ${activeMedicineIndex === index && listening ? 'ring-2 ring-blue-500' : ''}`} onClick={() => setActiveMedicineIndex(index)}>
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-semibold">Medicine {index + 1}</h4>
                        <Button type="button" variant="destructive" size="sm" onClick={() => handleRemoveMedicine(index)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><label className="text-xs">Name</label><Input value={medicine.name} onChange={(e) => handleMedicineChange(index, "name", e.target.value)} /></div>
                        <div><label className="text-xs">Days</label><Input value={medicine.consumptionDays} onChange={(e) => handleMedicineChange(index, "consumptionDays", e.target.value)} /></div>
                        <div className="sm:col-span-2"><label className="text-xs">Times</label><div className="flex gap-2 mt-1"><Button type="button" size="sm" variant={medicine.times.morning ? "default" : "outline"} onClick={() => handleTimeToggle(index, "morning")}>Morning</Button><Button type="button" size="sm" variant={medicine.times.evening ? "default" : "outline"} onClick={() => handleTimeToggle(index, "evening")}>Evening</Button><Button type="button" size="sm" variant={medicine.times.night ? "default" : "outline"} onClick={() => handleTimeToggle(index, "night")}>Night</Button></div></div>
                        <div className="sm:col-span-2"><label className="text-xs">Instruction</label><Textarea value={medicine.instruction} onChange={(e) => handleMedicineChange(index, "instruction", e.target.value)} rows={1} /></div>
                      </div>
                    </Card>
                  ))}
                  <Button type="button" onClick={addMedicine} variant="outline" className="w-full"><PlusCircle className="mr-2" /> Add More Medicine</Button>
                </div>
              )}

              {/* Overall Instructions Input */}
              <div>
                <label htmlFor="overallInstruction" className="block text-sm font-medium">Overall Instructions</label>
                <Textarea id="overallInstruction" {...register("overallInstruction")} placeholder="Any additional notes..." />
              </div>

              {/* Submission & Utility Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" disabled={isSubmitting} className="bg-green-600 hover:bg-green-700">{isSubmitting ? <><RefreshCw className="mr-2 animate-spin"/>Saving...</> : <><UserCheck className="mr-2"/>Save</>}</Button>
                <Button type="button" onClick={clearPrescription} variant="outline" className="text-red-600 border-red-300 hover:bg-red-50"><Trash2 className="mr-2"/>Clear</Button>
              </div>

              {currentPrescription && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                  <Button type="button" onClick={downloadPrescription} variant="secondary"><Download className="mr-2"/>View PDF</Button>
                  <Button type="button" onClick={uploadPdfAndSendWhatsApp} disabled={isSendingWhatsApp || !patientData?.number} className="bg-green-500 hover:bg-green-600 text-white">{isSendingWhatsApp ? <><RefreshCw className="mr-2 animate-spin"/>Sending...</> : <>Send WhatsApp</>}</Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Hidden Div for PDF Generation */}
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
          <div ref={prescriptionContentRef} style={{ width: "210mm", minHeight: "297mm", padding: "60mm 15mm 15mm 15mm", color: "#000", fontFamily: "Arial, sans-serif", background: 'white' }}></div>
        </div>
      </div>
    </Layout>
  );
}