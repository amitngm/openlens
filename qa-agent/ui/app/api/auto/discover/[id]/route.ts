import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * GET /api/auto/discover/[id]
 * Get auto discovery results
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    console.log('[GET /api/auto/discover]', { id });
    
    const response = await proxyToBackend(`/auto/discover/${id}`);
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Discovery not found', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[GET /api/auto/discover] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse('Cannot connect to QA Agent backend', 502);
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
