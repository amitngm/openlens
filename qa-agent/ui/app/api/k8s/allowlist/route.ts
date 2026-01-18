import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * POST /api/k8s/allowlist
 * Set namespace allowlist
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!Array.isArray(body.namespaces)) {
      return errorResponse('namespaces must be an array', 400);
    }
    
    const response = await proxyToBackend('/k8s/allowlist', {
      method: 'POST',
      body: JSON.stringify(body.namespaces),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to set allowlist', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[POST /api/k8s/allowlist] Error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}

/**
 * GET /api/k8s/allowlist
 * Get current namespace allowlist
 */
export async function GET() {
  try {
    const response = await proxyToBackend('/k8s/allowlist');
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to get allowlist', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[GET /api/k8s/allowlist] Error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
