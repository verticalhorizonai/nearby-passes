/**
 * SHARED CONTRACT — imported by both backend and frontend. DO NOT MODIFY without team-lead approval. ALL field names are camelCase at the API boundary.
 *
 * Project: Nearby (spec)
 *
 * Conventions:
 *  - All ID fields are string (UUID).
 *  - All timestamps are string (ISO 8601).
 *  - All money is integer cents in fields suffixed "Cents".
 *  - Inferred union literals are snake_case. Locked spec literals keep their exact casing.
 *  - This file uses no DOM or Node global types and compiles without the DOM library.
 *
 * Authorization model:
 *  - The spec declares no access-control role set and no sign-in ("a seat is not a sign-in").
 *  - Shopper, Merchant, Judge and Operator are feature personas only. No User, Session or
 *    AuthToken types are defined.
 *  - The confirmation token defined below is a single-use purchase gate, not an identity type.
 */

// ============================================================================
// LOCKED TYPE DEFINITIONS (verbatim from spec — DO NOT ALTER)
// ============================================================================

export type EveryVariable = 'DATABASE_URL' | 'APP_BASE_URL' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL' | 'AGENT_DISABLED' | 'PAYPAL_CLIENT_ID' | 'PAYPAL_CLIENT_SECRET' | 'PAYPAL_BASE_URL' | 'GOOGLE_MAPS_SERVER_KEY' | 'GOOGLE_MAPS_BROWSER_KEY' | 'APP_REPO_URL';

// ============================================================================
// AUTHORITATIVE UNION TYPES
// Neither agent may define its own variants.
// ============================================================================

/** Proposal lifecycle (REQ-03-12). 'expired' is final; 'declined' returns to 'proposed' when the shopper asks to see
 * the stop's hidden picks again (build ruling 40, amending spec 3.9.1). */
export type ProposalStatus = 'proposed' | 'accepted' | 'declined' | 'expired';

/** Purchase lifecycle (REQ-03-12): created -> approved -> completed, or failed. */
export type PurchaseStatus = 'created' | 'approved' | 'completed' | 'failed';

/** Why a calendar event was skipped and folded at the bottom of the list (REQ-01-02, REQ-01-05). */
export type SkippedEventReason = 'no_address' | 'video_call' | 'all_day' | 'no_coordinates' | 'out_of_area';
// 'no_coordinates' and 'out_of_area' carry the last rule of spec 3.2.3 (build ruling 9).

/**
 * Origin of a pick (REQ-02-02, REQ-03-06).
 * 'fallback' covers the top-2-by-score fixed-template path. That path is used when the
 * kill switch is on, the model call fails or times out, output validation fails, or a
 * rate limit is exceeded.
 */
/** 'assistant': the pick came through the checkout link an outside assistant handed over (build ruling 42). */
export type PickSource = 'agent' | 'fallback' | 'assistant';

/**
 * Who put an appointment in the session (build ruling 42): the connected calendar, or the person's own assistant
 * through a checkout link from the Nearby MCP server. My week labels the second "Added by your assistant".
 */
export type AppointmentAddedBy = 'calendar' | 'assistant';

/**
 * How the appointment map is rendered (REQ-02-01).
 * 'svg_plot' is used when no Google key is configured or a Google call fails.
 * In that case no error is shown to the shopper.
 */
export type MapRenderMode = 'google_maps' | 'svg_plot';

/** Pin kinds on the appointment map (REQ-02-01 marker hover/focus states). */
export type MapPinKind = 'appointment' | 'offer' | 'place';

/** Which side of Nearby is active (REQ-05-03, REQ-05-04). */
export type SeatKind = 'shopper' | 'merchant';

/** Offer valid days, chosen with checkboxes on the offer form (REQ-04-02). */
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Outcome of returning from PayPal checkout (REQ-03-01, REQ-03-10, REQ-08-06). */
export type PaymentReturnOutcome = 'completed' | 'failed';

/** Offer form fields that can carry an inline validation error (REQ-04-03, REQ-08-08). */
export type OfferFormField =
  | 'title'
  | 'priceCents'
  | 'regularPriceCents'
  | 'category'
  | 'validDays'
  | 'validStartTime'
  | 'validEndTime';

/** API error codes. */
export type ApiErrorCode =
  | 'validation_error'
  | 'not_found'
  /** HTTP 403. Purchase request lacks a valid, unexpired, unused confirmation token (REQ-03-08). */
  | 'confirmation_token_invalid'
  /** HTTP 403. A state-changing request whose Origin is not APP_BASE_URL (spec 3.9). */
  | 'forbidden_origin'
  /** HTTP 429. Too many checkout handoffs from this browser session in the last hour (build ruling 42). */
  | 'rate_limited'
  /** HTTP 409. A handed-over offer no longer fits that place and time (build ruling 42). */
  | 'offer_unavailable'
  /** HTTP 409. No pass can be claimed or the pass's state forbids the action (Nearby Passes 3.6.3; build ruling 49(e)). */
  | 'pass_unavailable'
  /** HTTP 503. The NEAR call failed or timed out, or passes are unavailable (Nearby Passes 3.6.3; build ruling 49(e)). */
  | 'near_unavailable'
  | 'internal_error';

/** Offer category (spec 3.8: coffee, lunch, dinner, juice or snack, service); time fit by category (REQ-02-07). */
export const OFFER_CATEGORIES = ['coffee', 'lunch', 'dinner', 'juice_or_snack', 'service'] as const;
export type OfferCategory = typeof OFFER_CATEGORIES[number];

// ============================================================================
// SPEC CONSTANTS
// ============================================================================

/** Offer price bounds (spec 3.8): price 50 to 50,000 cents; a regular price, when given, is greater than the price.
 * Dollar input with more than two decimals is refused, never rounded (ruling 4). */
export const OFFER_PRICE_MIN_CENTS = 50 as const;
export const OFFER_PRICE_MAX_CENTS = 50000 as const;

/** Appointment look-ahead window in days (REQ-01-02). */
export const APPOINTMENT_WINDOW_DAYS = 7 as const;

/** Maximum picks shown per appointment (REQ-02-02). */
export const MAX_PICKS_PER_APPOINTMENT = 2 as const;

/** Minimum candidate score for a pick. Below this, show the no-match message (REQ-02-03). */
export const MIN_PICK_SCORE = 0.35 as const;

/** Maximum words in a pick reason. This is validated in code before display (REQ-02-02, REQ-03-05). */
export const PICK_REASON_MAX_WORDS = 25 as const;

/** Agent model-call timeout in milliseconds (REQ-03-06). */
export const AGENT_TIMEOUT_MS = 20000 as const;

/** Agent rate limits (REQ-06-03). Exceeding either limit routes the request to fallback picks. */
export const AGENT_RATE_LIMIT_PER_SESSION_PER_HOUR = 30 as const;
export const AGENT_RATE_LIMIT_GLOBAL_PER_HOUR = 300 as const;

/** Confirmation token lifetime and minimum entropy (REQ-03-08). */
export const CONFIRMATION_TOKEN_TTL_MS = 600000 as const;
export const CONFIRMATION_TOKEN_MIN_BITS = 128 as const;

/** A proposed or accepted proposal is expired this long after it was created (spec 3.9.1); one with a completed purchase never expires (build ruling 7). */
export const PROPOSAL_EXPIRY_MS = 10800000 as const;

/** Redemption code format (REQ-03-11). Letters A-Z and digits 2-9, excluding I and O. */
export const REDEMPTION_CODE_LENGTH = 6 as const;
export const REDEMPTION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as const;

/** PayPal capture status that marks success. Any other value means the purchase failed (REQ-03-01). */
export const PAYPAL_CAPTURE_STATUS_COMPLETED = 'COMPLETED' as const;

/** The only PayPal base URL the app will start with (REQ-06-02, REQ-07-06). */
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com' as const;

/** Sales feed limits (REQ-04-04, REQ-04-05). */
export const SALES_FEED_MAX_ITEMS = 20 as const;
export const SALES_FEED_POLL_INTERVAL_MS = 3000 as const;
export const SALES_FEED_NEW_SALE_HIGHLIGHT_MS = 5000 as const;

/** Offer title length bounds (REQ-04-03). */
export const OFFER_TITLE_MIN_LENGTH = 1 as const;
export const OFFER_TITLE_MAX_LENGTH = 60 as const;

/** Number of seeded sample merchants (REQ-06-01). */
export const SAMPLE_MERCHANT_COUNT = 8 as const;

/** Calendar MCP server identity (REQ-01-04). */
export const CALENDAR_MCP_SERVER_NAME = 'nearby-calendar-mcp' as const;
export const CALENDAR_MCP_DAYS_AHEAD_DEFAULT = 7 as const;
export const CALENDAR_MCP_DAYS_AHEAD_MAX = 14 as const;

/** Fallback reason template (spec 3.6.4). */
export const FALLBACK_REASON_TEMPLATE = '{merchant} is {distance} from your {start time} and the deal runs {valid window}.' as const;

/** Fixed user-facing copy declared by the spec. */
export const DEMONSTRATION_BANNER_TEXT =
  'Demonstration. Sample merchants and offers, not real businesses. Payments run in the PayPal sandbox; no real money moves.' as const;
export const NO_MATCH_MESSAGE = 'Nothing nearby fits this one' as const;
export const PAYMENT_FAILED_MESSAGE = 'Payment did not go through. Nothing was charged.' as const;
export const RESET_DEMO_CONFIRM_PROMPT = "Remove this browser's proposals and purchases?" as const;

// ============================================================================
// API ENVELOPES
// ============================================================================

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface ApiCollectionResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
}

/** A single inline field error for the offer form (REQ-04-03, REQ-08-08). */
export interface FieldError {
  field: OfferFormField;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: {
      fieldErrors?: FieldError[];
    };
  };
}

// ============================================================================
// SHARED VALUE TYPES
// ============================================================================

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Offer valid window: days of week plus a daily time range in "HH:MM" 24-hour format. */
export interface ValidWindow {
  validDays: DayOfWeek[];
  /** "HH:MM", 24-hour. */
  validStartTime: string;
  /** "HH:MM", 24-hour. */
  validEndTime: string;
}

// ============================================================================
// PUBLIC CONFIG (Home Page footer link, map browser key)
// ============================================================================

export interface PublicConfig {
  /** Present only when APP_REPO_URL is set. The footer repo link is shown only then (REQ-05-01). */
  repoUrl: string | null;
  /** Browser-restricted Google Maps key. Null means the map uses 'svg_plot' (REQ-02-01). */
  googleMapsBrowserKey: string | null;
}

// ============================================================================
// CALENDAR CONNECTION (REQ-01-01)
// ============================================================================

export interface CalendarConnection {
  calendarName: string;
  /** Count of upcoming appointments in the next APPOINTMENT_WINDOW_DAYS days that have a usable address. */
  upcomingAppointmentCount: number;
  connectedAt: string;
}

/** Response to "Use the demo calendar". The request body is empty. */
export type ConnectDemoCalendarResponse = ApiResponse<CalendarConnection>;

// ============================================================================
// APPOINTMENT (REQ-01-02, REQ-01-03, REQ-01-05)
// ============================================================================

export interface Appointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  address: string;
  location: GeoPoint;
  /** False means the shopper turned the appointment off. It is then excluded from picks (REQ-01-03). */
  enabled: boolean;
  /** The calendar, or the person's assistant through a checkout handoff (build ruling 42). */
  addedBy: AppointmentAddedBy;
  createdAt: string;
  updatedAt: string;
}

/** Internal: used by the seed script for demo calendar fallback appointments (REQ-06-01). No HTTP create endpoint. */
export interface CreateAppointmentRequest {
  id?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  address: string;
  location: GeoPoint;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * HTTP: toggle an appointment on or off (REQ-01-03).
 * The id is taken from the route. The frontend applies this change optimistically and
 * reverts it if the save fails.
 */
export interface UpdateAppointmentRequest {
  enabled?: boolean;
}

/** A calendar event excluded from matching, shown folded at the bottom of the list (REQ-01-02). */
export interface SkippedEvent {
  title: string;
  startsAt: string;
  reason: SkippedEventReason;
}

/** An appointment in My week, with how many of its picks this browser session has bought (build ruling 36). */
export interface UpcomingAppointment extends Appointment {
  /** Completed purchases for this appointment in this browser session (0, 1 or 2). Created, approved and failed
   * purchases do not count. */
  boughtCount: number;
  /** Passes claimed for this appointment in this browser session (Nearby Passes F8.5; 0 when passes are off). */
  passCount: number;
}

export interface UpcomingAppointmentsResult {
  /** Appointments in the next 7 days with a usable address. */
  appointments: UpcomingAppointment[];
  skippedEvents: SkippedEvent[];
}

export type UpcomingAppointmentsResponse = ApiResponse<UpcomingAppointmentsResult>;
export type ToggleAppointmentResponse = ApiResponse<Appointment>;

// ============================================================================
// CALENDAR MCP SERVER (REQ-01-04)
// Read-only stdio MCP contract between the agent service and nearby-calendar-mcp.
// This is NOT the HTTP API boundary. The tool name and input field are reproduced
// exactly as declared by the spec, so snake_case is intentional here.
// ============================================================================

export type CalendarMcpToolName = 'list_upcoming_appointments';

export interface ListUpcomingAppointmentsToolInput {
  /** Integer. Defaults to CALENDAR_MCP_DAYS_AHEAD_DEFAULT (7). Maximum is CALENDAR_MCP_DAYS_AHEAD_MAX (14). */
  days_ahead?: number;
}
// The tool output shape is the one specified in the source requirements document.
// It is not restated here, so that no divergent definition is created.

// ============================================================================
// MERCHANT (REQ-04-01, REQ-05-03)
// ============================================================================

export interface Merchant {
  id: string;
  name: string;
  /** Merchant type, shown on the profile card and seat card. */
  type: string;
  area: string;
  location: GeoPoint;
  /** Always true for seeded demo merchants. Drives the Sample badge (honest demo data). */
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Internal: seed script only (REQ-06-01). No HTTP create endpoint. */
export interface CreateMerchantRequest {
  id?: string;
  name: string;
  type: string;
  area: string;
  location: GeoPoint;
  isSample: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Internal: idempotent re-seed upsert, so re-runs do not duplicate merchants (REQ-06-01). No HTTP update endpoint. */
export interface UpdateMerchantRequest {
  id: string;
  name?: string;
  type?: string;
  area?: string;
  location?: GeoPoint;
  isSample?: boolean;
}

// ============================================================================
// OFFER (REQ-04-02, REQ-04-03)
// Offers are live from the moment they are published. There is no status or paused state.
// ============================================================================

export interface Offer extends ValidWindow {
  id: string;
  merchantId: string;
  title: string;
  /** Integer cents — integer arithmetic only, never floating point */
  priceCents: number;
  /** Integer cents — integer arithmetic only, never floating point */
  regularPriceCents: number | null;
  category: OfferCategory;
  /** True when the price is a deposit. The receipt then shows a "redeem in store" note (REQ-03-01). */
  isDeposit: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * HTTP: Publish an offer from the merchant form (REQ-04-02).
 * The merchantId is taken from the route. The form takes dollars with at most two decimals and
 * converts them to integer cents before sending; more decimals are refused (ruling 4).
 */
export interface CreateOfferRequest extends ValidWindow {
  title: string;
  /** Integer cents — integer arithmetic only, never floating point */
  priceCents: number;
  /** Integer cents — integer arithmetic only, never floating point */
  regularPriceCents?: number | null;
  category: OfferCategory;
}

/** Internal: seed script offer record, which additionally carries the deposit flag (REQ-06-01). */
export interface SeedOfferInput extends CreateOfferRequest {
  id?: string;
  merchantId: string;
  isDeposit: boolean;
}

/** Internal: idempotent re-seed upsert (REQ-06-01). An HTTP edit replaces the offer instead (build ruling 44). */
export interface UpdateOfferRequest {
  id: string;
  title?: string;
  /** Integer cents — integer arithmetic only, never floating point */
  priceCents?: number;
  /** Integer cents — integer arithmetic only, never floating point */
  regularPriceCents?: number | null;
  category?: OfferCategory;
  validDays?: DayOfWeek[];
  validStartTime?: string;
  validEndTime?: string;
  isDeposit?: boolean;
}

/**
 * An offer as the merchant dashboard lists it to one browser session (build ruling 44): a seed offer (shared, a sample
 * offer) or one this session posted. Offers other sessions posted, and removed offers, are never listed.
 */
export interface MerchantOffer extends Offer {
  /** True for an offer this browser session posted: it can be edited and removed. False for a seed (sample) offer. */
  postedByYou: boolean;
  /**
   * For this session's own version of a sample offer (build ruling 45): the sample offer it replaces in this session's
   * demo only. Null for a sample offer and for a posted offer that replaces none.
   */
  replacesOfferId: string | null;
}

/** The plain line under, and in the view of, an offer that replaces a sample offer (build ruling 45). */
export const SAMPLE_REPLACEMENT_LINE = 'Your version. It replaces the sample offer in your demo only.' as const;

export type CreateOfferResponse = ApiResponse<MerchantOffer>;

/** Merchant dashboard payload: profile card plus offers list (REQ-04-01). */
export interface MerchantDashboard {
  merchant: Merchant;
  /** The seed offers and this session's own, newest first (build ruling 44). */
  offers: MerchantOffer[];
}

export type MerchantDashboardResponse = ApiResponse<MerchantDashboard>;

// ============================================================================
// GOOGLE PLACES + APPOINTMENT MAP (REQ-02-01, REQ-02-04, REQ-02-05)
// ============================================================================

export interface PlaceSummary {
  placeId: string;
  name: string;
  location: GeoPoint;
}

export interface MapMerchantPin {
  merchantId: string;
  merchantName: string;
  location: GeoPoint;
  isSample: boolean;
  /** True when the merchant has a matching offer highlighted on the map. */
  hasOffer: boolean;
}

export interface AppointmentMapData {
  appointment: Appointment;
  searchRadiusMeters: number;
  renderMode: MapRenderMode;
  /** Real Google places. This is empty when renderMode is 'svg_plot'. */
  places: PlaceSummary[];
  /** Required Google attribution strings. These must be shown wherever Places results appear. */
  placesAttributions: string[];
  merchants: MapMerchantPin[];
}

export type AppointmentMapResponse = ApiResponse<AppointmentMapData>;

// ============================================================================
// PROPOSAL (agent pick) (REQ-02-02, REQ-02-06..08, REQ-03-02, REQ-03-12)
// ============================================================================

export interface Proposal {
  id: string;
  appointmentId: string;
  offerId: string;
  merchantId: string;
  /** 1 or 2. */
  rank: number;
  /** Ranking score from 0 to 1. Only candidates with score >= MIN_PICK_SCORE become proposals. */
  score: number;
  /** One sentence, at most 25 words, naming the merchant, the distance and when the deal runs. */
  reason: string;
  distanceMeters: number;
  source: PickSource;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

/** Internal: created by the agent service or the fallback path. No HTTP create endpoint. */
export interface CreateProposalRequest {
  id?: string;
  appointmentId: string;
  offerId: string;
  merchantId: string;
  rank: number;
  score: number;
  reason: string;
  distanceMeters: number;
  source: PickSource;
  status?: ProposalStatus;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Internal: lifecycle transitions only.
 *  - proposed -> accepted (Yes)
 *  - proposed -> declined (Not now)
 *  - declined -> proposed (Show hidden picks, before expiry; build ruling 40)
 *  - accepted -> proposed (cancel at PayPal, or token expired unused)
 *  - proposed or accepted -> expired (3 hours after creation; never with a completed purchase, build ruling 7)
 */
export interface UpdateProposalRequest {
  id: string;
  status?: ProposalStatus;
}

/** A pick card as displayed to the shopper. */
export interface Pick {
  proposalId: string;
  merchantId: string;
  merchantName: string;
  merchantIsSample: boolean;
  offerId: string;
  offerTitle: string;
  /** Integer cents — integer arithmetic only, never floating point */
  priceCents: number;
  /** Integer cents — integer arithmetic only, never floating point */
  regularPriceCents: number | null;
  validWindow: ValidWindow;
  reason: string;
  distanceMeters: number;
  /** Rounded to two decimals; computed from unrounded distance (3.5.3). Not drawn on the card (ruling 3). */
  score: number;
  source: PickSource;
  status: ProposalStatus;
  /** True when this pick has a completed purchase: the card shows it as bought (3.9.1 with ruling 7; build ruling 24). */
  purchased: boolean;
  /** The offer's open pass, or null (Nearby Passes F8.3; always null when passes are off or claiming is unavailable). */
  pass: PickPass | null;
  /** This pick's claim as a pass, or null (Nearby Passes F8.5). */
  passClaim: PickPassClaim | null;
  /** The intent of the last Yes ('paypal' or 'pass'), or null before any Yes (Nearby Passes 3.6.3; ruling 54(b)). */
  acceptIntent: AcceptIntent | null;
}

export interface AppointmentPicks {
  appointmentId: string;
  /** At most MAX_PICKS_PER_APPOINTMENT entries. */
  picks: Pick[];
  /** True when no candidate scored >= MIN_PICK_SCORE. The UI then shows NO_MATCH_MESSAGE. */
  noMatch: boolean;
}

export type AppointmentPicksResponse = ApiResponse<AppointmentPicks>;

/**
 * POST /api/appointments/{appointmentId}/picks/restore (build ruling 40): this session's declined, unexpired picks for
 * the appointment return to 'proposed'. Idempotent; never runs the agent, never counts toward the rate limit, never
 * calls an outside service. The result is the appointment's picks afterwards, in their original order.
 */
export interface RestoreHiddenPicksResult extends AppointmentPicks {
  /** How many declined picks this call brought back (0 when none were hidden). */
  restored: number;
}

export type RestoreHiddenPicksResponse = ApiResponse<RestoreHiddenPicksResult>;

/** Response to "Not now" (REQ-03-02). The proposal becomes 'declined' and nothing is created at PayPal. */
export type DeclineProposalResponse = ApiResponse<Proposal>;

// ============================================================================
// CONFIRM + PAY (REQ-03-01, REQ-03-07, REQ-03-08, REQ-03-09)
// ============================================================================

/** Confirm sheet content shown before paying. */
export interface ConfirmSheet {
  proposalId: string;
  merchantName: string;
  merchantIsSample: boolean;
  offerTitle: string;
  /** Integer cents — integer arithmetic only, never floating point */
  priceCents: number;
  validWindow: ValidWindow;
}

/**
 * Response to a Yes tap.
 * A random single-use token (>= 128 bits) is minted and bound to the proposal and the
 * browser's session. Only its hash is stored server-side. It expires
 * CONFIRMATION_TOKEN_TTL_MS after minting.
 */
export interface AcceptProposalResult {
  confirmSheet: ConfirmSheet;
  confirmationToken: string;
  confirmationTokenExpiresAt: string;
  /** The intent the token was minted for (Nearby Passes 3.6.3); 'paypal' when the request named none. */
  intent: AcceptIntent;
  /** The pass confirm sheet when intent is 'pass', else null (Nearby Passes F8.4). */
  passSheet: PassConfirmSheet | null;
}

/** Body of POST /api/proposals/{proposalId}/accept (Nearby Passes 3.6.3). Optional; no body means 'paypal'. */
export interface AcceptProposalRequest {
  intent?: AcceptIntent;
}

export type AcceptProposalResponse = ApiResponse<AcceptProposalResult>;

/**
 * HTTP: "Pay with PayPal".
 * The amount is NEVER sent from the browser. The server reads the offer's price itself.
 * A missing, invalid, expired or used token is rejected with HTTP 403
 * ('confirmation_token_invalid') and nothing is created at PayPal.
 */
export interface StartPaymentRequest {
  proposalId: string;
  confirmationToken: string;
}

export interface StartPaymentResult {
  purchaseId: string;
  /** PayPal sandbox payer-action URL that the shopper is redirected to. */
  payerActionUrl: string;
}

export type StartPaymentResponse = ApiResponse<StartPaymentResult>;

// ============================================================================
// PURCHASE (REQ-03-09..12)
// ============================================================================

export interface Purchase {
  id: string;
  proposalId: string;
  offerId: string;
  merchantId: string;
  /** Integer cents — integer arithmetic only, never floating point */
  amountCents: number;
  paypalOrderId: string;
  status: PurchaseStatus;
  /** Set only when the capture status is COMPLETED. It is unique among purchases (REQ-03-11). */
  redemptionCode: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Internal: created server-side when the PayPal order is created. No direct HTTP create endpoint. */
export interface CreatePurchaseRequest {
  id?: string;
  proposalId: string;
  offerId: string;
  merchantId: string;
  /** Integer cents — integer arithmetic only, never floating point */
  amountCents: number;
  paypalOrderId: string;
  status?: PurchaseStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** Internal: lifecycle transitions on approval, capture or failure. */
export interface UpdatePurchaseRequest {
  id: string;
  status?: PurchaseStatus;
  redemptionCode?: string | null;
  completedAt?: string | null;
}

/**
 * Receipt shown after a completed capture.
 * A duplicate return to the capture URL shows the same receipt again and captures nothing.
 */
export interface Receipt {
  purchaseId: string;
  merchantName: string;
  merchantIsSample: boolean;
  offerTitle: string;
  /** Integer cents — integer arithmetic only, never floating point */
  amountCents: number;
  redemptionCode: string;
  /** True when the offer is a deposit. The UI then shows the "redeem in store" note. */
  isDeposit: boolean;
  completedAt: string;
}

/**
 * Result of returning from PayPal through the return URL or the cancel URL.
 *  - 'completed': a receipt is present. The success toast is shown.
 *  - 'failed': the capture was not COMPLETED, or the shopper cancelled. The purchase is
 *    marked failed, the proposal reverts to 'proposed', the pick is still available, and
 *    PAYMENT_FAILED_MESSAGE is shown.
 */
export type PaymentReturnResult =
  | { outcome: Extract<PaymentReturnOutcome, 'completed'>; proposalId: string; receipt: Receipt }
  | { outcome: Extract<PaymentReturnOutcome, 'failed'>; proposalId: string; message: typeof PAYMENT_FAILED_MESSAGE };

export type PaymentReturnResponse = ApiResponse<PaymentReturnResult>;

/**
 * GET /api/proposals/{proposalId}/receipt (build ruling 38): the receipt of a pick this browser session bought, so the
 * redemption code can be shown again from the pick card. Read only: never calls PayPal, never changes anything. 404
 * unless the proposal is this session's and its purchase is completed.
 */
export type ProposalReceiptResponse = ApiResponse<Receipt>;

// ============================================================================
// LIVE SALES FEED (REQ-04-04, REQ-04-05)
// ============================================================================

/** A completed sale on the merchant's live feed. */
export interface SalesFeedItem {
  purchaseId: string;
  offerTitle: string;
  /** Integer cents — integer arithmetic only, never floating point */
  amountCents: number;
  completedAt: string;
  redemptionCode: string;
}

/**
 * The feed is polled every SALES_FEED_POLL_INTERVAL_MS.
 * It holds at most SALES_FEED_MAX_ITEMS items, newest first.
 */
export interface SalesFeed {
  merchantId: string;
  items: SalesFeedItem[];
}

export type SalesFeedResponse = ApiResponse<SalesFeed>;

// ============================================================================
// SEATS (REQ-05-03, REQ-05-04, REQ-05-07)
// ============================================================================

/** An appointment tile on the Shopper seat card. The demo shows five of these. */
export interface AppointmentTile {
  appointmentId: string;
  title: string;
  startsAt: string;
}

export interface ShopperSeatCard {
  appointments: AppointmentTile[];
}

/** A merchant seat card: name, Sample badge, type, area, and an offer with its price. */
export interface MerchantSeatCard {
  merchantId: string;
  name: string;
  isSample: boolean;
  type: string;
  area: string;
  offerTitle: string;
  /** Integer cents — integer arithmetic only, never floating point */
  offerPriceCents: number;
  /** True when the price is a deposit: the card reads "$1.50 deposit" (design/choose-a-seat.html; build ruling 23). */
  offerIsDeposit: boolean;
}

export interface ChooseSeatData {
  shopper: ShopperSeatCard;
  /** SAMPLE_MERCHANT_COUNT entries. */
  merchants: MerchantSeatCard[];
}

export type ChooseSeatResponse = ApiResponse<ChooseSeatData>;

/** Current seat chip shown in the header, for example "Shopper" or "Merchant: Saguaro Bean Co. (Sample)". */
export interface CurrentSeat {
  seat: SeatKind;
  /** Null when seat is 'shopper'. */
  merchantId: string | null;
  /** Null when seat is 'shopper'. */
  merchantName: string | null;
  /** Null when seat is 'shopper'. */
  merchantIsSample: boolean | null;
}

// ============================================================================
// RESET DEMO (REQ-05-02)
// Removes this browser session's proposals and purchases and turns every appointment
// back on. Sample data stays.
// ============================================================================

export interface ResetDemoResult {
  proposalsRemoved: number;
  purchasesRemoved: number;
  appointmentsReenabled: number;
  /** Stops an outside assistant added through a checkout handoff; removed with their picks (build ruling 42). */
  assistantStopsRemoved: number;
  /** Offers this session posted, removed (build ruling 44). */
  postedOffersRemoved: number;
  /** The session's new demo NEAR account after the reset (Nearby Passes 3.6.2). Present only when passes are on, so the
   * result is unchanged with NEAR_NETWORK unset (REQ-14-06). */
  nearAccountId?: string;
}

export type ResetDemoResponse = ApiResponse<ResetDemoResult>;

// ============================================================================
// VERIFICATION TARGETS (REQ-07-01..07)
// These features define no endpoints or types. They are verified against existing
// surfaces, as follows:
//  - Adapter Pattern: AppointmentMapData.renderMode and Pick.source.
//  - PayPal Sandbox-Only Safety: the startup guard checks PAYPAL_BASE_URL against
//    PAYPAL_SANDBOX_BASE_URL.
//  - Credential Isolation: EveryVariable.
// Agent rate limiting (REQ-06-03) and the AGENT_DISABLED kill switch (REQ-06-04) are
// observed through Pick.source and server logs. No operational endpoints are defined
// for them.
// ============================================================================
// ============================================================================
// OFFERS FOR ANY AGENT: THE MCP SERVER AND THE CHECKOUT HANDOFF (build ruling 42)
// ============================================================================

/** Path of the public MCP server (Streamable HTTP, stateless, read-only, no sign-in). */
export const MCP_PATH = '/mcp' as const;
/** The two read-only tools of the Nearby MCP server. Neither can buy. */
export const OFFERS_MCP_TOOL_NAMES = ['find_offers_near', 'get_offer'] as const;
export type OffersMcpToolName = typeof OFFERS_MCP_TOOL_NAMES[number];
/** Requests to /mcp per client address per minute, counted in the process. */
export const MCP_REQUESTS_PER_ADDRESS_PER_MINUTE = 60 as const;
/** Checkout handoffs (POST /api/handoff) per browser session per hour. */
export const HANDOFFS_PER_SESSION_PER_HOUR = 10 as const;
/** A stop an assistant hands over has no end time; it is matched as an appointment of this length. */
export const ASSISTANT_STOP_MINUTES = 60 as const;
/** The longest radius find_offers_near accepts, in miles: the matching never looks past 3 miles (3.5.1). */
export const MCP_MAX_RADIUS_MILES = 3 as const;
/** A title in a checkout link is data: text only, at most this many characters. */
export const HANDOFF_TITLE_MAX_LENGTH = 80 as const;
/** A place name in a checkout link is data: text only, at most this many characters (build ruling 47). */
export const HANDOFF_PLACE_MAX_LENGTH = 80 as const;
/** The longest title or place the MCP tools accept before it is cut to its limit (bounds the request). */
export const MCP_TEXT_INPUT_MAX_LENGTH = 500 as const;
/** The stop's title when the link carries none. */
export const HANDOFF_DEFAULT_TITLE = 'Stop from your assistant' as const;

/**
 * The checkout link's query (GET /handoff page, GET /api/handoff, body of POST /api/handoff): the offer, the place and
 * the start time the assistant searched with, and an optional title. Strings, as they arrive in a URL.
 */
export interface HandoffParams {
  offer: string;
  lat: string;
  lng: string;
  /** ISO 8601 with an offset, e.g. 2026-11-17T09:30:00-07:00. */
  at: string;
  /** What the stop is, e.g. "Lunch with Sam". Text only; the default title when missing. */
  title?: string;
  /** A short name for the place, e.g. "Fourth Avenue, Tucson" (build ruling 47). Text only; "Near <coordinates>" when missing. */
  place?: string;
}

/** GET /api/handoff: what the handoff page shows. Read-only: nothing is written. */
export interface HandoffPreview {
  offerId: string;
  offerTitle: string;
  merchantName: string;
  merchantIsSample: boolean;
  /** Integer cents, read from the database (never from the link). */
  priceCents: number;
  isDeposit: boolean;
  validWindow: ValidWindow;
  /** The stop's title as it will be stored: text only, at most HANDOFF_TITLE_MAX_LENGTH characters. */
  title: string;
  /** The place name from the link (text only, at most HANDOFF_PLACE_MAX_LENGTH characters), else "Near <coordinates>". */
  address: string;
  location: GeoPoint;
  startsAt: string;
  endsAt: string;
  /** False when the offer no longer fits this place and time; the page then says so and offers My week. */
  fits: boolean;
  /** Why it does not fit, in plain words; null when it fits. */
  note: string | null;
}

export type HandoffPreviewResponse = ApiResponse<HandoffPreview>;

/** POST /api/handoff ("Review in Nearby"): the stop and its proposed pick in this browser's session. */
export interface HandoffResult {
  appointmentId: string;
  proposalId: string;
  /** False when the same link had already been handed over in this session (idempotent). */
  created: boolean;
}

export type HandoffResponse = ApiResponse<HandoffResult>;

// ============================================================================
// SIGNS OF LIFE: THE AGENT'S RUN, LIVE (build ruling 43)
// ============================================================================

/** 'agent': Claude is running its tools. 'fallback': the run went straight to the fallback and has no steps. */
export type AgentRunMode = 'agent' | 'fallback';

/** One of the agent's real tool calls, recorded as it starts, in plain words ("Checking 3 offers"). */
export interface AgentRunStep {
  /** The tool's name, e.g. find_offer_candidates. */
  tool: string;
  label: string;
  startedAt: string;
}

/** A run of the agent for one of this session's stops, while it is in flight. Held in the process only. */
export interface AgentRun {
  appointmentId: string;
  mode: AgentRunMode;
  startedAt: string;
  /** In the order the tool calls started; empty for a fallback run. */
  steps: AgentRunStep[];
}

/** GET /api/agent/runs: this session's runs in flight. Read only; empty when nothing is running. */
export interface AgentRunsResult {
  runs: AgentRun[];
}

export type AgentRunsResponse = ApiResponse<AgentRunsResult>;

/** How often the client asks for the runs in flight, and only while something is in flight. */
export const AGENT_RUNS_POLL_MS = 700 as const;

// ============================================================================
// A POSTED OFFER BELONGS TO ITS SESSION: VIEW, REMOVE, EDIT (build ruling 44)
// ============================================================================

/** Offers posted per browser session per hour; an edit counts as a post. */
export const OFFER_POSTS_PER_SESSION_PER_HOUR = 10 as const;

/** POST /api/merchants/{merchantId}/offers/{offerId}/remove: the offer is marked removed, never deleted. */
export interface RemoveOfferResult {
  offerId: string;
  /** This session's open picks for the offer that were withdrawn (they end as expired). */
  picksWithdrawn: number;
}

export type RemoveOfferResponse = ApiResponse<RemoveOfferResult>;

/**
 * POST /api/merchants/{merchantId}/offers/{offerId}/edit (body CreateOfferRequest): the old offer is removed exactly
 * as Remove does and a new offer with the edited fields is created, in one transaction. On a sample offer (build
 * ruling 45) the sample row is not changed: the new offer is this session's copy, which replaces the sample offer in
 * this session only, and this session's open picks for the sample offer are withdrawn.
 */
export interface EditOfferResult {
  offer: MerchantOffer;
  replacedOfferId: string;
  picksWithdrawn: number;
}

export type EditOfferResponse = ApiResponse<EditOfferResult>;

// ============================================================================
// NEARBY PASSES ON NEAR (delta spec builds/nearby-passes/spec.md; REQ-09-01 to REQ-15-09; build ruling 49)
// Amounts on chain are yoctoNEAR as decimal strings (u128); the app writes them as text like "0.1 testnet NEAR".
// No amount is ever read from a request: the server computes every deposit.
// ============================================================================

/** The intent a confirmation token is minted for (3.6.3). */
export const ACCEPT_INTENTS = ['paypal', 'pass'] as const;
export type AcceptIntent = typeof ACCEPT_INTENTS[number];

/** A pass's status on chain (3.4.1). The app never stores it. */
export const PASS_STATUSES = ['Open', 'Claimed', 'Redeemed', 'Refunded'] as const;
export type PassStatus = typeof PASS_STATUSES[number];

/** pass_claims.status: the app's claim of a pick, not the pass's status. */
export type PassClaimStatus = 'pending' | 'claimed' | 'failed';
/** pass_actions (build ruling 49(b)). */
export type PassActionKind = 'fund' | 'redeem' | 'refund';
export type PassActionActor = 'merchant' | 'upkeep';
export type NearAccountSource = 'demo' | 'wallet';

/** Token ids are pass-1, pass-2, ... (3.4.1). The redeem field also accepts the bare number (build ruling 49(c)). */
export const PASS_TOKEN_ID_PATTERN = /^pass-[0-9]+$/;

/** F10.2 choices. */
export const PASS_FUND_COUNT_MIN = 1;
export const PASS_FUND_COUNT_MAX = 5;
export const PASS_CASH_BACK_OPTIONS = ['0.05', '0.1', '0.25'] as const;
export type PassCashBack = typeof PASS_CASH_BACK_OPTIONS[number];
export const PASS_EXPIRY_OPTIONS = { '5m': 300_000, '24h': 86_400_000, '7d': 604_800_000 } as const;
export type PassExpiry = keyof typeof PASS_EXPIRY_OPTIONS;

/** Contract limits (3.4.2), checked again by the contract. */
export const PASS_MINT_COUNT_MAX = 10;
export const PASS_MIN_VALUE_NEAR = '0.01';
export const PASS_MAX_EXPIRY_MS = 30 * 86_400_000;
export const PASS_TITLE_MAX_LENGTH = 80;
export const PASS_DESCRIPTION_MAX_LENGTH = 200;
export const PASS_OFFER_ID_MAX_LENGTH = 64;

/** Upkeep and seeding (3.6.6, 3.8). */
export const OPEN_PASSES_KEPT = 3;
export const UPKEEP_INTERVAL_MS = 300_000;
export const UPKEEP_REFUND_DELAY_MS = 900_000;
export const SAMPLE_PASS_EXPIRY_MS = 48 * 3_600_000;

/** Caches and calls (3.6.1, F8.4). */
export const NEAR_VIEW_CACHE_MS = 10_000;
export const NEAR_CALL_TIMEOUT_MS = 20_000;
export const REDEEM_GAS_TGAS = 50;
export const REFUND_EXPIRED_MAX_PER_CALL = 10;

/** Limits (3.6.4), in process like the existing ones. Over a limit: 429 rate_limited. */
export const PASS_CLAIMS_PER_SESSION_PER_HOUR = 5;
export const PASS_CLAIMS_PER_HOUR = 60;
export const PASS_FUNDINGS_PER_SESSION_PER_HOUR = 3;
export const PASS_REDEMPTIONS_PER_SESSION_PER_HOUR = 20;

/** Words (Part 2). */
export const DEMO_ACCOUNT_LABEL = 'Demo account, testnet';
export const PASS_AGENT_SENTENCE = "Nearby's agent claims it for you. It cannot move money.";
export const MERCHANT_PASSES_NOT_SET_UP = 'Passes are set up for four sample merchants in this demo.';
export const PASS_SAMPLE_LINE = 'Sample merchant. Testnet only.';

/** GET /api/near/account (F8.1, F13.3). */
export interface NearAccountResult {
  /** False when NEAR_NETWORK is unset: the app is Nearby as accepted and every other field is null or false. */
  passesEnabled: boolean;
  /** False when claiming is paused on chain or the agent runs low (F13.3); the reason is plain text. */
  claimsAvailable: boolean;
  unavailableReason: string | null;
  network: 'testnet' | null;
  accountId: string | null;
  source: NearAccountSource | null;
  explorerUrl: string | null;
}
export type NearAccountResponse = ApiResponse<NearAccountResult>;

/** POST /api/near/account (F8.2, Should). */
export interface SetWalletAccountRequest {
  accountId: string;
}

/** The pass facts on a pick, a candidate or an MCP offer (F8.3, 3.6.5). */
export interface PickPass {
  openCount: number;
  cashBackYocto: string;
  /** "0.1 testnet NEAR". */
  cashBackText: string;
  /** Expiry of the oldest open pass, the one a claim takes (ISO 8601). */
  expiresAt: string;
}

export interface PickPassClaim {
  status: PassClaimStatus;
  tokenId: string | null;
  /** The plain message when failed. */
  error: string | null;
}

/** The pass confirm sheet (F8.4). */
export interface PassConfirmSheet {
  proposalId: string;
  merchantName: string;
  merchantIsSample: boolean;
  offerTitle: string;
  cashBackText: string;
  expiresAt: string;
  receivingAccountId: string;
  /** PASS_AGENT_SENTENCE. */
  agentSentence: string;
}

/** A pass as the contract reports it (get_pass), with links the server adds. */
export interface PassView {
  tokenId: string;
  status: PassStatus;
  /** True at or past expiry (a Claimed or Open pass then shows Refund available). */
  expired: boolean;
  merchantAccountId: string;
  /** The app's merchant when the account is a known sample merchant's, else null. */
  merchantId: string | null;
  merchantName: string | null;
  merchantIsSample: boolean;
  offerId: string;
  title: string;
  description: string;
  valueYocto: string;
  valueText: string;
  expiresAt: string;
  claimedAt: string | null;
  settledAt: string | null;
  ownerId: string;
  mediaUrl: string;
  ownerExplorerUrl: string;
  /** The transaction of the last action the app sent for this pass (claim, redeem or refund), or null (ruling 49(b)). */
  lastTxUrl: string | null;
}
export type PassResponse = ApiResponse<PassView>;

/** POST /api/passes/claim (F8.4). Nothing else in the body is read. */
export interface ClaimPassRequest {
  proposalId: string;
  confirmationToken: string;
}
export interface ClaimPassResult {
  pass: PassView;
  txHash: string;
  txUrl: string;
}
export type ClaimPassResponse = ApiResponse<ClaimPassResult>;

/** GET /api/passes/mine (F9.1). */
export interface MyPassesResult {
  accountId: string;
  passes: PassView[];
}
export type MyPassesResponse = ApiResponse<MyPassesResult>;

/** One seeded offer's passes (F10.3). */
export interface OfferPassStats {
  offerId: string;
  offerTitle: string;
  open: number;
  claimed: number;
  redeemed: number;
  refunded: number;
  heldYocto: string;
  heldText: string;
}

/** GET /api/merchants/{merchantId}/passes (F10.1, F10.3, F11.2). */
export interface MerchantPassesResult {
  /** False for a merchant with no NEAR account; then notice is MERCHANT_PASSES_NOT_SET_UP and the rest is empty. */
  nearEnabled: boolean;
  notice: string | null;
  accountId: string | null;
  balanceYocto: string | null;
  balanceText: string | null;
  explorerUrl: string | null;
  heldYocto: string;
  heldText: string;
  /** PASS_STORAGE_ESTIMATE_NEAR in yocto: the storage deposit per pass funding adds (F10.2 total; ruling 54(c)). */
  storageEstimateYocto: string;
  offers: OfferPassStats[];
  /** The merchant's passes, newest first (passes_for_merchant). */
  passes: PassView[];
}
export type MerchantPassesResponse = ApiResponse<MerchantPassesResult>;

/** POST /api/merchants/{merchantId}/offers/{offerId}/passes (F10.2). The deposit is computed on the server. */
export interface FundPassesRequest {
  count: number;
  cashBack: PassCashBack;
  expiry: PassExpiry;
}
export interface FundPassesResult {
  tokenIds: string[];
  passes: PassView[];
  depositYocto: string;
  depositText: string;
  txHash: string;
  txUrl: string;
}
export type FundPassesResponse = ApiResponse<FundPassesResult>;

/** POST /api/merchants/{merchantId}/passes/{tokenId}/redeem (F11.1). */
export interface RedeemPassResult {
  pass: PassView;
  /** "Redeemed. 0.1 testnet NEAR sent to the holder." */
  message: string;
  txHash: string;
  txUrl: string;
}
export type RedeemPassResponse = ApiResponse<RedeemPassResult>;

/** POST /api/merchants/{merchantId}/passes/refund-expired (F11.2). */
export interface RefundExpiredResult {
  refunded: { tokenId: string; valueText: string; txHash: string; txUrl: string }[];
  balanceText: string | null;
}
export type RefundExpiredResponse = ApiResponse<RefundExpiredResult>;

/** GET /api/near/agent (F12.2): the agent account's keys as the RPC reports them now. */
export interface AgentKey {
  publicKey: string;
  kind: 'function_call' | 'full_access';
  receiverId: string | null;
  methodNames: string[];
  allowanceYocto: string | null;
  allowanceText: string | null;
}
export interface AgentKeysResult {
  accountId: string;
  explorerUrl: string;
  contractId: string;
  /** APP_REPO_URL + '/tree/main/contracts/passes', or null when APP_REPO_URL is unset. */
  contractSourceUrl: string | null;
  claimsPaused: boolean;
  keys: AgentKey[];
}
export type AgentKeysResponse = ApiResponse<AgentKeysResult>;

/** One line of the merchant's pass activity (F11.3, Should). */
export interface PassActivityItem {
  kind: 'claim' | 'fund' | 'redeem' | 'refund';
  tokenId: string;
  at: string;
  txUrl: string | null;
}

/** GET /api/merchants/{merchantId}/passes/activity (F11.3, Should): the merchant's pass activity, newest first, at
 * most SALES_FEED_MAX_ITEMS; polled at the sales feed's rate. Empty for a merchant with no NEAR account. */
export interface PassActivityResult {
  items: PassActivityItem[];
}
export type PassActivityResponse = ApiResponse<PassActivityResult>;
