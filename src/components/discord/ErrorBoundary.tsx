"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Rendering error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex items-center justify-center min-h-[200px] p-6">
          <div className="bg-[#F6606F]/10 border border-[#F6606F]/20 rounded-xl p-4 max-w-md text-center">
            <p className="text-[#F6606F] text-sm font-bold mb-1">Lỗi hiển thị</p>
            <p className="text-[#8A8F98] text-xs">{this.state.error?.message || "Có lỗi xảy ra khi hiển thị nội dung"}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 px-4 py-1.5 bg-[#5865F2] text-white text-xs rounded-lg hover:bg-[#4752C4] transition-colors"
            >
              Thử lại
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
