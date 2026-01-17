import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse, QA_AGENT_API_URL } from '@/lib/api-client';

/**
 * GET /api/run/[id]/artifacts
 * Proxy to QA_AGENT_API_URL/run/{id}/artifacts
 * 
 * Returns: { run_id, count, artifacts: [{ name, size, type, download_url }] }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    if (!id) {
      return errorResponse('Run ID is required', 400);
    }
    
    console.log(`[GET /api/run/${id}/artifacts]`);
    
    // Forward to backend
    const response = await proxyToBackend(`/run/${id}/artifacts`);
    const data = await response.json();
    
    // Handle backend errors
    if (!response.ok) {
      return NextResponse.json(
        { 
          error: data.detail || 'Artifacts not found',
          status: response.status 
        },
        { status: response.status }
      );
    }
    
    // Rewrite download URLs to point to our proxy (optional)
    // This ensures the frontend can download artifacts through our API
    if (data.artifacts) {
      data.artifacts = data.artifacts.map((artifact: any) => ({
        ...artifact,
        // Keep original backend URL or proxy through Next.js
        download_url: artifact.download_url || `${QA_AGENT_API_URL}/artifacts/${id}/${artifact.name}`,
        // Add proxy URL for CORS-safe access
        proxy_url: `/api/artifacts/${id}/${artifact.name}`
      }));
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error(`[GET /api/run/${params.id}/artifacts] Error:`, error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse(
        'Cannot connect to QA Agent backend',
        502,
        'Make sure the backend is running'
      );
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
