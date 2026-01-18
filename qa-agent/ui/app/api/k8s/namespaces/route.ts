import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * GET /api/k8s/namespaces
 * List Kubernetes namespaces
 */
export async function GET() {
  try {
    const response = await proxyToBackend('/k8s/namespaces');
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to list namespaces', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[GET /api/k8s/namespaces] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse('Cannot connect to QA Agent backend', 502);
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
