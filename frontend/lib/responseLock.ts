/** Why a member can't change their answers on a track the TD locked — one
 *  wording on the overview card, the edit page, and the member page. */
export const TRACK_LOCKED_REASON =
  "The tournament director has closed this track to changes. Contact them if something needs updating.";

/** The same, for when every track is locked and there is nothing left to edit
 *  at all. Not "your tracks": the lock is on the track, for everyone. */
export const ALL_TRACKS_LOCKED_REASON =
  "The tournament director has closed all tracks to changes. Contact them if something needs updating.";

/** Why a track the member hasn't answered can't be edited: the first answer
 *  always goes through a form (the backend refuses it otherwise — see
 *  require_track_answered). Deliberately doesn't point at a form: if the TD
 *  hasn't set one up, "fill out the form" sends the member looking for
 *  something that isn't there. */
export const TRACK_UNANSWERED_REASON = "You haven't answered for this track yet.";

/** The same, for when no track has an answer yet. */
export const NO_TRACKS_ANSWERED_REASON = "You haven't answered for any tracks yet.";
