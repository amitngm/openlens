import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * GET /api/run/[id]
 * Proxy to QA_AGENT_API_URL/run/{id}
 * 
 * Returns: { run_id, status, summary, test_results }
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
    
    console.log(`[GET /api/run/${id}]`);
    
    // Forward to backend
    const response = await proxyToBackend(`/run/${id}`);
    const data = await response.json();
    
    // Handle backend errors
    if (!response.ok) {
      return NextResponse.json(
        { 
          error: data.detail || 'Run not found',
          status: response.status 
        },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error(`[GET /api/run/${params.id}] Error:`, error);
    
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
