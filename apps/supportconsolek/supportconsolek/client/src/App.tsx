/**
 * ⚠️ BEFORE MODIFYING THIS FILE:
 *
 * 1. Create SQL files in config/queries/
 * 2. Run `npm run typegen` to generate query types
 * 3. Check appKitTypes.d.ts for available types
 *
 * Common Mistakes:
 * - DataTable does NOT accept `data` or `columns` props
 * - Charts use `xKey` and `yKey`, NOT `seriesKey`/`nameKey`/`valueKey`
 * - useAnalyticsQuery has no `enabled` option - use conditional rendering
 */
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@databricks/appkit-ui/react";

type Summary = { requests: number; actions: number; replies: number };

type Recommendation = {
  amount_usd?: number | null;
  reason?: string;
};

type Report = {
  draft_response?: string;
  past_interactions_summary?: string;
  order_details_summary?: string;
  decision_confidence?: string;
  escalation_flag?: boolean;
  refund_recommendation?: Recommendation | null;
  credit_recommendation?: Recommendation | null;
};

type CaseState = {
  case_status: "pending" | "in_progress" | "done" | "blocked";
  next_action: string;
  has_reply: boolean;
  has_refund: boolean;
  has_credit: boolean;
  action_count: number;
  reply_count: number;
  regen_count: number;
  last_action_type?: string | null;
  last_event_at?: string | null;
  latest_report_source?: string | null;
};

type TimelineEvent = {
  event_type: string;
  event_at: string;
  actor?: string | null;
  details?: Record<string, unknown>;
};

type RegenerationItem = {
  regenerated_report_id: number;
  operator_context?: string | null;
  actor?: string | null;
  created_at: string;
  report: Report;
};

type RequestItem = {
  support_request_id: string;
  user_id: string;
  user_display_name?: string | null;
  order_id: string;
  ts: string;
  report: Report;
  case_state?: CaseState;
};

type RequestDetails = RequestItem & {
  actions: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  regenerations?: RegenerationItem[];
  timeline?: TimelineEvent[];
};

type NoticeState = {
  kind: "success" | "error";
  message: string;
  supportRequestId?: string;
} | null;

function App() {
  const PAGE_SIZE = 50;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [totalRequests, setTotalRequests] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<RequestDetails | null>(null);
  const [replyText, setReplyText] = useState("");
  const [operatorContext, setOperatorContext] = useState("");
  const [actor, setActor] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"apply_refund" | "apply_credit" | "send_reply" | "regenerate" | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [error, setError] = useState<string | null>(null);
  const drawerScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refresh();
  }, [currentPage]);

  const formatCurrency = (value?: number | null) =>
    typeof value === "number" ? `$${value.toFixed(2)}` : "No recommendation";

  const formatTs = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Recent";
    }
    return date.toLocaleString();
  };

  const statusLabel = (status: CaseState["case_status"] | undefined) => {
    if (status === "done") return "Done";
    if (status === "in_progress") return "In Progress";
    if (status === "blocked") return "Blocked";
    return "Pending";
  };

  const statusVariant = (status: CaseState["case_status"] | undefined): "default" | "secondary" | "outline" => {
    if (status === "done") return "default";
    if (status === "in_progress") return "secondary";
    return "outline";
  };

  const nextActionLabel = (nextAction: string | undefined) => {
    const mapping: Record<string, string> = {
      review_report: "Review report",
      apply_resolution_or_regenerate: "Apply resolution or re-gen",
      send_customer_reply: "Send customer reply",
      monitor: "Monitor case",
      investigate_blocker: "Investigate blocker",
      continue_investigation: "Continue investigation",
    };
    return mapping[nextAction ?? ""] ?? "Review report";
  };

  const suggestedRefund = selected?.report?.refund_recommendation?.amount_usd ?? null;
  const suggestedCredit = selected?.report?.credit_recommendation?.amount_usd ?? null;
  const selectedCaseState = selected?.case_state;

  const appliedRefund = selected?.actions.find((a) => a.action_type === "apply_refund");
  const appliedCredit = selected?.actions.find((a) => a.action_type === "apply_credit");

  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const parseErrorMessage = async (res: Response): Promise<string> => {
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      return body.message || body.error || `Request failed (${res.status})`;
    } catch {
      return `Request failed (${res.status})`;
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = (currentPage - 1) * PAGE_SIZE;
      const [summaryRes, reqRes] = await Promise.all([
        fetch("/api/support/summary"),
        fetch(`/api/support/requests?limit=${PAGE_SIZE}&offset=${offset}`),
      ]);
      if (!summaryRes.ok || !reqRes.ok) {
        throw new Error("Failed to load support data");
      }
      const summaryJson = (await summaryRes.json()) as Summary;
      const reqJson = (await reqRes.json()) as { items?: RequestItem[]; total?: number };
      setSummary(summaryJson);
      setRequests(reqJson.items || []);
      setTotalRequests(reqJson.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (
    supportRequestId: string,
    options?: { showLoading?: boolean; preserveScroll?: boolean },
  ) => {
    const showLoading = options?.showLoading ?? true;
    const preserveScroll = options?.preserveScroll ?? false;
    const previousScrollTop = preserveScroll ? drawerScrollRef.current?.scrollTop ?? 0 : 0;
    setIsDrawerOpen(true);
    if (showLoading) {
      setDetailsLoading(true);
    }
    setNotice((prev) => (prev?.supportRequestId === supportRequestId ? prev : null));
    try {
      const res = await fetch(`/api/support/requests/${supportRequestId}`);
      if (!res.ok) {
        throw new Error("Failed to load request details");
      }
      const json = (await res.json()) as RequestDetails;
      setSelected(json);
      setReplyText(json?.report?.draft_response ?? "");
      setRefundAmount(
        typeof json?.report?.refund_recommendation?.amount_usd === "number"
          ? String(json.report.refund_recommendation.amount_usd)
          : "",
      );
      setCreditAmount(
        typeof json?.report?.credit_recommendation?.amount_usd === "number"
          ? String(json.report.credit_recommendation.amount_usd)
          : "",
      );
      setError(null);
      if (preserveScroll) {
        requestAnimationFrame(() => {
          if (drawerScrollRef.current) {
            drawerScrollRef.current.scrollTop = previousScrollTop;
          }
        });
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      if (showLoading) {
        setDetailsLoading(false);
      }
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalRequests / PAGE_SIZE));

  const applyAction = async (actionType: "apply_refund" | "apply_credit", amount: string) => {
    if (!selected) return;
    if (!amount || Number.isNaN(Number(amount))) return;
    setPendingAction(actionType);
    setNotice(null);
    try {
      const res = await fetch("/api/support/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          support_request_id: selected.support_request_id,
          order_id: selected.order_id,
          user_id: selected.user_id,
          action_type: actionType,
          amount_usd: Number(amount),
          actor: actor || null,
          payload: { source: "appkit-ui" },
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res));
      }
      setNotice({
        kind: "success",
        message: actionType === "apply_credit" ? "Credits applied successfully." : "Refund applied successfully.",
        supportRequestId: selected.support_request_id,
      });
      await openDetails(selected.support_request_id, { showLoading: false, preserveScroll: true });
      await refresh();
    } catch (e) {
      setNotice({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const sendReply = async () => {
    if (!selected) return;
    setPendingAction("send_reply");
    setNotice(null);
    try {
      const res = await fetch("/api/support/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          support_request_id: selected.support_request_id,
          order_id: selected.order_id,
          user_id: selected.user_id,
          message_text: replyText,
          sent_by: actor || null,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res));
      }
      setNotice({
        kind: "success",
        message: "Reply sent successfully.",
        supportRequestId: selected.support_request_id,
      });
      await openDetails(selected.support_request_id, { showLoading: false, preserveScroll: true });
      await refresh();
    } catch (e) {
      setNotice({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const regenerateReport = async () => {
    if (!selected) return;
    setPendingAction("regenerate");
    setNotice(null);
    try {
      const res = await fetch("/api/support/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          support_request_id: selected.support_request_id,
          order_id: selected.order_id,
          user_id: selected.user_id,
          actor: actor || null,
          operator_context: operatorContext || null,
          current_report: selected.report,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res));
      }
      setNotice({
        kind: "success",
        message: "Report regenerated with operator context.",
        supportRequestId: selected.support_request_id,
      });
      await openDetails(selected.support_request_id, { showLoading: false, preserveScroll: true });
      await refresh();
    } catch (e) {
      setNotice({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 w-full">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support Console</h1>
          <p className="text-muted-foreground">
            Triage support requests, review agent analysis, and take operator actions.
          </p>
        </div>
        <Button onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-destructive/50">
          <CardContent className="pt-6 text-destructive">Error: {error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary?.requests ?? "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary?.actions ?? "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Replies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary?.replies ?? "-"}</div>
          </CardContent>
        </Card>
      </div>

      <div className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>Support Requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[72vh] overflow-auto">
            {loading && requests.length === 0 && (
              <>
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={`skeleton-${idx}`}
                    className="border rounded-lg p-4 space-y-2 animate-pulse"
                  >
                    <div className="h-4 w-48 bg-muted rounded" />
                    <div className="h-3 w-64 bg-muted rounded" />
                    <div className="h-3 w-32 bg-muted rounded" />
                  </div>
                ))}
              </>
            )}
            {requests.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No support requests yet.
              </div>
            )}
            {requests.map((r) => {
              const previewSource =
                r.report?.draft_response ||
                r.report?.order_details_summary ||
                "Support request ready for review.";
              const preview = previewSource.replace(/\s+/g, " ").trim();
              return (
                <div
                  key={r.support_request_id}
                  className="border rounded-lg p-3 flex justify-between items-start gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center flex-wrap gap-2">
                      <div className="text-sm font-medium">
                        {r.user_display_name ?? "Customer"}
                      </div>
                      <Badge variant={statusVariant(r.case_state?.case_status)} className="text-xs">
                        {statusLabel(r.case_state?.case_status)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Next: {nextActionLabel(r.case_state?.next_action)}
                      </Badge>
                      {r.case_state?.has_reply && <Badge variant="secondary" className="text-xs">Replied</Badge>}
                      {r.case_state?.has_refund && <Badge variant="secondary" className="text-xs">Refund Applied</Badge>}
                      {r.case_state?.has_credit && <Badge variant="secondary" className="text-xs">Credits Applied</Badge>}
                      <Badge variant="secondary" className="text-xs">
                        Refund: {formatCurrency(r.report?.refund_recommendation?.amount_usd)}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        Credit: {formatCurrency(r.report?.credit_recommendation?.amount_usd)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Updated {formatTs(r.case_state?.last_event_at ?? r.ts)}</span>
                      <Badge variant="outline" className="text-[10px]">
                        Replies {r.case_state?.reply_count ?? 0}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        Actions {r.case_state?.action_count ?? 0}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        Re-gens {r.case_state?.regen_count ?? 0}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground truncate">{preview}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => void openDetails(r.support_request_id)}>
                    Open
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={currentPage <= 1 || loading}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={currentPage >= totalPages || loading}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent
          side="right"
          className="p-0 !w-[96vw] sm:!w-[92vw] md:!w-[86vw] lg:!w-[78vw] xl:!w-[72vw] 2xl:!w-[68vw] !max-w-[1400px]"
        >
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="px-8 pt-8 pb-4 text-left">
              <SheetTitle className="text-3xl">Request Details</SheetTitle>
              <SheetDescription className="text-base">
              Review agent analysis and take operator actions for the selected support case.
              </SheetDescription>
            </SheetHeader>
            <div ref={drawerScrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 pb-8">
            {notice && (
              <Card className={notice.kind === "error" ? "border-destructive/50" : "border-emerald-500/40"}>
                <CardContent className={notice.kind === "error" ? "pt-4 text-destructive" : "pt-4 text-emerald-500"}>
                  {notice.message}
                </CardContent>
              </Card>
            )}
            {detailsLoading && <div className="text-muted-foreground">Loading request details...</div>}
            {!detailsLoading && !selected && (
              <div className="text-muted-foreground">Select a request from the list.</div>
            )}
            {!detailsLoading && selected && (
              <>
                <div className="rounded-xl border bg-muted/35 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selected.user_display_name ?? "Customer"}</Badge>
                    <Badge variant="secondary">
                      Updated: {formatTs(selectedCaseState?.last_event_at ?? selected.ts)}
                    </Badge>
                    <Badge variant="secondary">
                      Confidence: {selected.report?.decision_confidence ?? "unknown"}
                    </Badge>
                    <Badge variant={statusVariant(selectedCaseState?.case_status)}>
                      {statusLabel(selectedCaseState?.case_status)}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Case State</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Next: {nextActionLabel(selectedCaseState?.next_action)}</Badge>
                    <Badge variant="secondary">Last Action: {selectedCaseState?.last_action_type ?? "none"}</Badge>
                    <Badge variant="secondary">Report: {selectedCaseState?.latest_report_source ?? "sync"}</Badge>
                    <Badge variant="secondary">Replies: {selectedCaseState?.reply_count ?? 0}</Badge>
                    <Badge variant="secondary">Actions: {selectedCaseState?.action_count ?? 0}</Badge>
                    <Badge variant="secondary">Re-gens: {selectedCaseState?.regen_count ?? 0}</Badge>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Timeline</div>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {(selected.timeline ?? []).slice(0, 8).map((event, idx) => (
                      <div key={`${event.event_type}-${event.event_at}-${idx}`} className="text-sm rounded-md border bg-background/70 p-2">
                        <div className="font-medium">{event.event_type.replaceAll("_", " ")}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatTs(event.event_at)}{event.actor ? ` · ${event.actor}` : ""}
                        </div>
                      </div>
                    ))}
                    {(selected.timeline ?? []).length === 0 && (
                      <div className="text-sm text-muted-foreground">No activity yet.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-2">
                  <div className="text-lg font-semibold">Past Interactions Summary</div>
                  <div className="text-sm whitespace-pre-wrap leading-6">
                    {selected.report?.past_interactions_summary}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-2">
                  <div className="text-lg font-semibold">Order Details Summary</div>
                  <div className="text-sm whitespace-pre-wrap leading-6">
                    {selected.report?.order_details_summary}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="bg-muted/25">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Refund Recommendation</CardTitle>
                    </CardHeader>
                    <CardContent className="text-lg font-medium">
                      {formatCurrency(selected.report?.refund_recommendation?.amount_usd)}
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/25">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Credit Recommendation</CardTitle>
                    </CardHeader>
                    <CardContent className="text-lg font-medium">
                      {formatCurrency(selected.report?.credit_recommendation?.amount_usd)}
                    </CardContent>
                  </Card>
                </div>
                <div className="rounded-xl border bg-muted/35 p-4">
                  <div className="flex flex-wrap gap-2">
                    {appliedRefund ? (
                      <Badge variant="secondary">
                        Refund Applied: {formatCurrency(toNumber(appliedRefund.amount_usd))}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Refund not applied</Badge>
                    )}
                    {appliedCredit ? (
                      <Badge variant="secondary">
                        Credits Applied: {formatCurrency(toNumber(appliedCredit.amount_usd))}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Credits not applied</Badge>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Replies</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {selected.replies.length === 0 && (
                      <div className="text-sm text-muted-foreground">No replies sent yet.</div>
                    )}
                    {selected.replies.map((reply, idx) => (
                      <div key={`reply-${idx}`} className="rounded-md border bg-background/70 p-3">
                        <div className="text-xs text-muted-foreground">
                          {formatTs(String(reply.created_at ?? ""))}
                          {reply.sent_by ? ` · ${String(reply.sent_by)}` : ""}
                        </div>
                        <div className="text-sm mt-1 whitespace-pre-wrap">
                          {String(reply.message_text ?? "")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Regeneration History</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(selected.regenerations ?? []).length === 0 && (
                      <div className="text-sm text-muted-foreground">No regenerated reports yet.</div>
                    )}
                    {(selected.regenerations ?? []).map((regen) => (
                      <div
                        key={`regen-${regen.regenerated_report_id}`}
                        className="rounded-md border bg-background/70 p-3 space-y-1"
                      >
                        <div className="text-xs text-muted-foreground">
                          {formatTs(regen.created_at)}{regen.actor ? ` · ${regen.actor}` : ""}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {regen.operator_context || "No operator context provided."}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Reply Draft</div>
                  <Textarea
                    className="min-h-[120px]"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Operator Context for Re-Gen</div>
                  <Textarea
                    className="min-h-[96px]"
                    value={operatorContext}
                    onChange={(e) => setOperatorContext(e.target.value)}
                    placeholder="Add extra context or constraints before regenerating this report..."
                  />
                  <div className="text-xs text-muted-foreground">
                    Re-generation calls the model endpoint and can take up to ~30 seconds.
                  </div>
                  <div>
                    <Button onClick={() => void regenerateReport()} disabled={detailsLoading || pendingAction !== null}>
                      {pendingAction === "regenerate" ? (
                        <span className="inline-flex items-center">
                          <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          Regenerating...
                        </span>
                      ) : (
                        "Re-Generate Report"
                      )}
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/35 p-5 space-y-3">
                  <div className="text-lg font-semibold">Actions</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={actor} placeholder="Operator" onChange={(e) => setActor(e.target.value)} />
                    <div className="w-fit">
                      <Button onClick={() => void sendReply()} disabled={detailsLoading || pendingAction !== null}>
                        {pendingAction === "send_reply" ? (
                          <span className="inline-flex items-center">
                            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Sending...
                          </span>
                        ) : (
                          "Reply"
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <Input
                      value={refundAmount}
                      placeholder={suggestedRefund !== null ? String(suggestedRefund) : "No suggestion"}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      disabled={Boolean(appliedRefund) || pendingAction !== null}
                    />
                    <div className="w-fit">
                      <Button
                        onClick={() => void applyAction("apply_refund", refundAmount)}
                        disabled={!refundAmount || detailsLoading || Boolean(appliedRefund) || pendingAction !== null}
                      >
                        {pendingAction === "apply_refund" ? (
                          <span className="inline-flex items-center">
                            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Applying...
                          </span>
                        ) : appliedRefund ? (
                          "Refund Applied"
                        ) : (
                          "Apply Refund"
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <Input
                      value={creditAmount}
                      placeholder={suggestedCredit !== null ? String(suggestedCredit) : "No suggestion"}
                      onChange={(e) => setCreditAmount(e.target.value)}
                      disabled={Boolean(appliedCredit) || pendingAction !== null}
                    />
                    <div className="w-fit">
                      <Button
                        onClick={() => void applyAction("apply_credit", creditAmount)}
                        disabled={!creditAmount || detailsLoading || Boolean(appliedCredit) || pendingAction !== null}
                      >
                        {pendingAction === "apply_credit" ? (
                          <span className="inline-flex items-center">
                            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Applying...
                          </span>
                        ) : appliedCredit ? (
                          "Credits Applied"
                        ) : (
                          "Apply Credit"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
            </div>
            <SheetFooter className="border-t px-8 py-4">
              <SheetClose asChild>
              <Button variant="outline">Close</Button>
              </SheetClose>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default App;
