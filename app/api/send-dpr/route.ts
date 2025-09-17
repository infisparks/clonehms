
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const pdfFile = formData.get('pdfFile') as Blob | null;
    const caption = formData.get('caption') as string | null;
    const filename = formData.get('filename') as string | null; // Get filename from FormData as well

    if (!pdfFile || !caption || !filename) {
      return NextResponse.json({ message: 'Missing required fields.' }, { status: 400 });
    }

    // Convert Blob to Buffer for Supabase upload
    const decodedPdf = Buffer.from(await pdfFile.arrayBuffer());

    // 2. Upload to Supabase bucket
    const { data, error: uploadError } = await supabase.storage
      .from('dpr-documents') // Changed to new bucket
      .upload(`dpr/${filename}`, decodedPdf, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return NextResponse.json({ message: `Failed to upload PDF: ${uploadError.message}` }, { status: 500 });
    }

    // 3. Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('dpr-documents') // Changed to new bucket
      .getPublicUrl(data.path);

    const imageUrl = publicUrlData.publicUrl;

    if (!imageUrl) {
      return NextResponse.json({ message: 'Failed to get public URL for PDF.' }, { status: 500 });
    }

    // 4. Send to WhatsApp image API
    const whatsappApiUrl = 'https://a.infispark.in/send-image-url';
    const whatsappToken = '9958399157'; // Your provided token
    const recipientNumber = '918907866786'; // Your provided number

    const whatsappRes = await fetch(whatsappApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: whatsappToken,
        number: recipientNumber,
        imageUrl: imageUrl,
        caption: caption,
      }),
    });

    if (whatsappRes.ok) {
      const whatsappResult = await whatsappRes.json();
      return NextResponse.json({ message: 'DPR sent successfully to Meraj Sir!', whatsappResult }, { status: 200 });
    } else {
      const errorData = await whatsappRes.json();
      console.error('WhatsApp API error:', errorData);
      return NextResponse.json({ message: `Failed to send WhatsApp message: ${errorData.message}` }, { status: whatsappRes.status });
    }
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ message: 'Internal server error.' }, { status: 500 });
  }
}