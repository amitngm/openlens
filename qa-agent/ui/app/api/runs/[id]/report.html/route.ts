import { NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const runId = params.id;
    const response = await proxyToBackend(`/runs/${runId}/report.html`);
    
    if (!response.ok) {
      return errorResponse('Report not found', response.status);
    }
    
    const html = await response.text();
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch report',
      500
    );
  }
}
