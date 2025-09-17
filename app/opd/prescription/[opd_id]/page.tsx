"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm, SubmitHandler } from "react-hook-form";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  ArrowLeft,
  Eye,
  Download,
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

interface OPDPrescriptionRow {
  id: string;
  opd_id: number;
  uhid: string;
  symptoms: string | null;
  known_case_of: string | null;
  treatment: string | null;
  past_history: string | null;
  follow_up: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

interface PrescriptionFormInputs {
  symptoms: string;
  known_case_of: string;
  treatment: string;
  past_history: string;
  follow_up: string;
}
// --- End Type Definitions ---

export default function OPDPrescriptionPage() {
  const { opd_id } = useParams<{ opd_id: string }>();
  const router = useRouter();

  // State
  const [patientData, setPatientData] = useState<PatientDetail | null>(null);
  const [currentPrescription, setCurrentPrescription] = useState<OPDPrescriptionRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyModalItems, setHistoryModalItems] = useState<OPDPrescriptionRow[]>([]);

  // Refs
  const prescriptionContentRef = useRef<HTMLDivElement>(null);

  const { register, handleSubmit, reset, setValue, getValues } = useForm<PrescriptionFormInputs>({
    defaultValues: { symptoms: "", known_case_of: "", treatment: "", past_history: "", follow_up: "" },
  });

  const [activeField, setActiveField] = useState<keyof PrescriptionFormInputs | null>(null);

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
        known_case_of: formData.known_case_of,
        treatment: formData.treatment,
        past_history: formData.past_history,
        follow_up: formData.follow_up,
        updated_at: new Date().toISOString(),
        updated_by: currentUserEmail,
      };

      const { error } = currentPrescription
        ? await supabase.from("opd_prescriptions").update(prescriptionPayload).eq("opd_id", opdNum)
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
      command: ["clinical symptoms *", "symptoms *", "symptom *", "input 1 *", "input one *"],
      callback: (content: string) => {
        setActiveField("symptoms");
        setValue("symptoms", `${getValues("symptoms") || ""} ${content}`.trim());
        toast.info(`Clinical symptoms updated: ${content}`);
      },
    },
    {
      command: ["known case of *", "known history *", "input 2 *", "history *", "input two *","input to *"],
      callback: (content: string) => {
        setActiveField("known_case_of");
        setValue("known_case_of", `${getValues("known_case_of") || ""} ${content}`.trim());
        toast.info(`Known case of updated: ${content}`);
      },
    },
    {
      command: ["treatment *", "prescribe *", "input 3 *", "input three *"],
      callback: (content: string) => {
        setActiveField("treatment");
        setValue("treatment", `${getValues("treatment") || ""} ${content}`.trim());
        toast.info(`Treatment updated: ${content}`);
      },
    },
    {
      command: ["past history *", "previous history *", "input 4 *", "input four *","input for *",],
      callback: (content: string) => {
        setActiveField("past_history");
        setValue("past_history", `${getValues("past_history") || ""} ${content}`.trim());
        toast.info(`Past history updated: ${content}`);
      },
    },
    {
      command: ["follow up *", "next visit *", "revisit *", "input 5 *", "input five *"],
      callback: (content: string) => {
        setActiveField("follow_up");
        setValue("follow_up", `${getValues("follow_up") || ""} ${content}`.trim());
        toast.info(`Follow up updated: ${content}`);
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
    {
      command: ["clear input", "clear field"],
      callback: () => {
        if (activeField) {
          setValue(activeField, "");
          toast.info(`${activeField} cleared.`);
        } else {
          toast.info("No active field to clear.");
        }
      },
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
      resetTranscript(); // Clear transcript when starting to listen
      SpeechRecognition.startListening({ continuous: true, language: "en-IN" });
    }
  };
  
  // --- Data Fetching & Component Logic ---
  const fetchPatientAndPrescriptionData = useCallback(async () => {
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
        setValue("known_case_of", presData.known_case_of || "");
        setValue("treatment", presData.treatment || "");
        setValue("past_history", presData.past_history || "");
        setValue("follow_up", presData.follow_up || "");
      } else {
        setCurrentPrescription(null); reset();
      }
    } catch (error) { toast.error("An unexpected error occurred."); router.push("/opd/list/opdlistprescripitono"); }
    finally { setIsLoading(false); }
  }, [opd_id, router, setValue, reset]);

  useEffect(() => { fetchPatientAndPrescriptionData(); }, [fetchPatientAndPrescriptionData]);

  // --- Real-time Subscription ---
  useEffect(() => {
    if (!opd_id) return;
    const channel = supabase.channel(`opd_prescription_opd_id_${opd_id}`).on("postgres_changes", { event: "*", schema: "public", table: "opd_prescriptions", filter: `opd_id=eq.${opd_id}`}, payload => { toast.info(`Prescription data updated.`); fetchPatientAndPrescriptionData(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [opd_id, fetchPatientAndPrescriptionData]);

  // --- Helper Functions ---
  const clearPrescription = () => {
    reset();
    resetTranscript();
    toast.info("Form cleared.");
  };

  // --- PDF & WhatsApp Functions ---
  const generatePDFBlob = useCallback(async (prescriptionData: OPDPrescriptionRow | null) => {
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
        <div style="margin-bottom: 5mm;"><h3 style="font-size: 13pt; margin-bottom: 1mm; border-bottom: 1px dashed #ccc;">Clinical Symptoms</h3><p>${dataToUse.symptoms || "N/A"}</p></div>
        <div style="margin-bottom: 5mm;"><h3 style="font-size: 13pt; margin-bottom: 1mm; border-bottom: 1px dashed #ccc;">Known Case of/History</h3><p>${dataToUse.known_case_of || "N/A"}</p></div>
        <div style="margin-bottom: 5mm;"><h3 style="font-size: 13pt; margin-bottom: 1mm; border-bottom: 1px dashed #ccc;">Treatment</h3><p>${dataToUse.treatment || "N/A"}</p></div>
        <div style="margin-bottom: 5mm;"><h3 style="font-size: 13pt; margin-bottom: 1mm; border-bottom: 1px dashed #ccc;">Past History</h3><p>${dataToUse.past_history || "N/A"}</p></div>
        <div style="margin-bottom: 5mm;"><h3 style="font-size: 13pt; margin-bottom: 1mm; border-bottom: 1px dashed #ccc;">Follow-up</h3><p>${dataToUse.follow_up || "N/A"}</p></div>
      `;
      
      const canvas = await html2canvas(prescriptionContentRef.current, { scale: 2 });
      pdf.addImage(canvas.toDataURL("image/jpeg", 1.0), "JPEG", 0, 0, pdfWidth, canvas.height * pdfWidth / canvas.width);
      
      if (prescriptionContentRef.current) { 
        prescriptionContentRef.current.style.cssText = originalRefStyle; 
        prescriptionContentRef.current.innerHTML = ''; 
      }
      return pdf.output("blob");
  }, [patientData, currentPrescription]);

  const downloadPrescription = async () => {
      const pdfBlob = await generatePDFBlob(currentPrescription);
      if (!pdfBlob) { toast.error("Failed to generate PDF."); return; }
      const blobURL = URL.createObjectURL(pdfBlob);
      window.open(blobURL, "_blank");
      toast.success("PDF opened successfully!");
  };
  
  const uploadPdfAndSendWhatsApp = async () => {
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
      const pdfBlob = await generatePDFBlob(historyItem);
      if (!pdfBlob) { toast.error("Failed to generate historical PDF."); return; }
      window.open(URL.createObjectURL(pdfBlob), "_blank");
  };
  
  // --- History Fetching ---
  const fetchPreviousPrescriptions = useCallback(async () => {
    if (!patientData?.uhid) return;
    try {
      const { data, error } = await supabase.from("opd_prescriptions").select("*").eq("uhid", patientData.uhid).order("created_at", { ascending: false });
      if (error) throw error;
      setHistoryModalItems(data.filter((item) => item.opd_id !== currentPrescription?.opd_id));
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
              {/* Clinical Symptoms Input */}
              <div>
                <label htmlFor="symptoms" className="block text-sm font-medium">1. Clinical Symptoms</label>
                <div className="relative">
                  <Textarea id="symptoms" {...register("symptoms")} placeholder="Enter symptoms or say 'clinical symptoms', 'symptoms', 'symptom', 'input 1', 'input one' followed by content" className="pr-10 text-sm" />
                  <Button variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => setValue("symptoms", "")}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Known Case of/History Input */}
              <div>
                <label htmlFor="known_case_of" className="block text-sm font-medium">2. Known Case of/History</label>
                <div className="relative">
                  <Textarea id="known_case_of" {...register("known_case_of")} placeholder="Enter known cases or say 'known case of', 'known history', 'input 2', 'history', 'input two', 'input to' followed by content" className="pr-10 text-sm" />
                  <Button variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => setValue("known_case_of", "")}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Treatment Input */}
              <div>
                <label htmlFor="treatment" className="block text-sm font-medium">3. Treatment</label>
                <div className="relative">
                  <Textarea id="treatment" {...register("treatment")} placeholder="Enter treatment or say 'treatment', 'prescribe', 'input 3', 'input three' followed by content" className="pr-10 text-sm" />
                  <Button variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => setValue("treatment", "")}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Past History Input */}
              <div>
                <label htmlFor="past_history" className="block text-sm font-medium">4. Past History</label>
                <div className="relative">
                  <Textarea id="past_history" {...register("past_history")} placeholder="Enter past history or say 'past history', 'input for' 'previous history', 'input 4', 'input four' followed by content" className="pr-10 text-sm" />
                  <Button variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => setValue("past_history", "")}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              
              {/* Follow-up Input */}
              <div>
                <label htmlFor="follow_up" className="block text-sm font-medium">5. Follow-up</label>
                <div className="relative">
                  <Textarea id="follow_up" {...register("follow_up")} placeholder="Enter follow-up details or say 'follow up', 'next visit', 'revisit', 'input 5', 'input five' followed by content" className="pr-10 text-sm" />
                  <Button variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => setValue("follow_up", "")}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button type="submit" disabled={isSubmitting} className="flex-1 bg-green-600 hover:bg-green-700">
                  {isSubmitting ? <><RefreshCw className="mr-2 animate-spin"/>Saving...</> : <><UserCheck className="mr-2"/>Save</>}
                </Button>
                <Button type="button" onClick={clearPrescription} variant="outline" className="flex-1 text-red-600 border-red-300 hover:bg-red-50">
                  <Trash2 className="mr-2"/>Clear
                </Button>
                <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="flex-1"><History className="mr-2" /> View History</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[900px]">
                    <DialogHeader>
                      <DialogTitle>Previous Prescriptions for {patientData.name}</DialogTitle>
                      <DialogDescription>
                        This is a history of prescriptions for this patient.
                      </DialogDescription>
                    </DialogHeader>
                    {historyModalItems.length > 0 ? (
                      <div className="overflow-auto max-h-[60vh]">
                        <Table>
                          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Symptoms</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                          <TableBody>{historyModalItems.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>{format(parseISO(item.created_at), "MMM dd, yyyy")}</TableCell>
                                <TableCell className="whitespace-normal max-w-[200px] overflow-hidden text-ellipsis">{item.symptoms}</TableCell>
                                <TableCell><Button size="sm" onClick={() => viewHistoryPrescription(item)}><Eye className="h-4 w-4 mr-1" /> View PDF</Button></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-center text-gray-500">No previous prescriptions found.</p>
                    )}
                  </DialogContent>
                </Dialog>
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