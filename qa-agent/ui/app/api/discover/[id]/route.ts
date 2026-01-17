import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * GET /api/discover/[id]
 * Proxy to QA_AGENT_API_URL/discover/{id}
 * 
 * Returns: discovery.json content
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    if (!id) {
      return errorResponse('Discovery ID is required', 400);
    }
    
    console.log(`[GET /api/discover/${id}]`);
    
    // Forward to backend
    const response = await proxyToBackend(`/discover/${id}`);
    const data = await response.json();
    
    // Handle backend errors
    if (!response.ok) {
      return NextResponse.json(
        { 
          error: data.detail || 'Discovery not found',
          status: response.status 
        },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error(`[GET /api/discover/${params.id}] Error:`, error);
    
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
