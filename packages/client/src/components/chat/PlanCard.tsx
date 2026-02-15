import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { MarkdownRenderer } from '../common/MarkdownRenderer';

interface Props {
  toolCall: SessionMessage;
  result?: SessionMessage;
  fullContent: string;
  defaultCollapsed?: boolean;
}

export function PlanCard({ toolCall, result, fullContent, defaultCollapsed }: Props) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);

  const input = toolCall.toolInput as Record<string, unknown> | undefined;
  const isEdit = toolCall.toolName === 'Edit';
  const filePath = String(input?.file_path ?? '');
  const fileName = filePath.split('/').pop()?.split('\\').pop() ?? filePath;

  if (!fullContent) return null;

  return (
    <>
      {/* Inline card */}
      <div className="mx-4 my-2">
        <div
          className="border-l-[3px] border-l-sky-500 bg-sky-950/30 border border-sky-800/50 rounded-r-lg overflow-hidden cursor-pointer hover:bg-sky-950/40 transition-colors"
          onClick={() => collapsed ? setCollapsed(false) : setOverlayOpen(true)}
        >
          {/* Header */}
          <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? '' : 'border-b border-sky-800/30'}`}>
            <svg className={`w-4 h-4 text-sky-400 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs font-medium text-sky-300">
              {isEdit ? 'Plan Updated' : 'Plan'}
            </span>
            <span className="text-xs text-slate-500 truncate">{fileName}</span>
            {!collapsed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOverlayOpen(true);
                }}
                className="ml-auto text-slate-500 hover:text-sky-400 transition-colors shrink-0"
                title="Expand plan"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            )}
          </div>

          {/* Content preview */}
          {!collapsed && (
            <div className="px-3 py-2 max-h-80 overflow-hidden relative">
              <div className="text-sm">
                <MarkdownRenderer content={fullContent} />
              </div>
              {/* Gradient fade at bottom */}
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-sky-950/80 to-transparent pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      {/* Full-screen overlay */}
      {overlayOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setOverlayOpen(false)}
        >
          <div
            className="h-full bg-slate-900 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-700">
              <button
                onClick={() => setOverlayOpen(false)}
                className="p-1 -ml-1 text-slate-400 hover:text-white transition-colors border border-slate-600 rounded"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-medium text-sky-300">Plan</span>
              <span className="text-xs text-slate-500 truncate">{fileName}</span>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="text-sm">
                <MarkdownRenderer content={fullContent} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
