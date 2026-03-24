/**
 * All But This Swipe — index.js
 * -----------------------------------------------------------------------------
 * A SillyTavern extension that adds a "Delete All But This Swipe" option to
 * the existing message-deletion popup, and registers two slash commands:
 *   /keepswipe       — trims excess swipes from the last AI message only.
 *   /cleanallswipes  — retroactively trims excess swipes across the full chat history.
 *
 * Author : Metro
 * Version: 1.1.0
 * -----------------------------------------------------------------------------
 * File location (install for all users):
 *   SillyTavern/public/scripts/extensions/third-party/all-but-this-swipe/index.js
 *
 * All imports are relative to that location.
 */

// -- Slash-command infrastructure ---------------------------------------------
import { SlashCommand }          from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser }    from '../../../slash-commands/SlashCommandParser.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

// -- Optional: import ST's own saveChat so we always have a reliable reference.
// If this import ever breaks (ST restructures its exports), the code falls back
// to SillyTavern.getContext().saveChat — see saveCurrentChat() below.
let _saveChat = null;
try {
    const stScript = await import('../../../../script.js');
    // ST exposes both saveChatConditional (preferred) and saveChat
    _saveChat = stScript.saveChatConditional ?? stScript.saveChat ?? null;
} catch (_) { /* use getContext fallback */ }

// -- Module identity ----------------------------------------------------------
const MODULE_NAME = 'All-But-This-Swipe';

// Attribute we stamp on our injected button so we never inject it twice
// into the same popup instance.
const INJECTED_ATTR = 'data-abts-injected';


// =============================================================================
//  Utility helpers
// =============================================================================

/**
 * Persist the current chat to disk.
 * Tries the imported ST function first; falls back to the context API.
 */
async function saveCurrentChat() {
    if (typeof _saveChat === 'function') {
        await _saveChat();
        return;
    }
    // Fallback — getContext().saveChat may or may not exist depending on version
    const ctx = SillyTavern.getContext();
    if (typeof ctx.saveChat === 'function') {
        await ctx.saveChat();
    } else {
        console.warn(`[${MODULE_NAME}] Could not locate a saveChat function. ` +
        'The chat may not have been saved to disk.');
    }
}

/**
 * Find the first visible ST popup that contains a message-deletion prompt.
 * We identify it by looking for a button whose text matches "Delete Swipe"
 * (ST only renders that button when a message has > 1 swipe).
 *
 * Returns null when no such popup is open (e.g. single-swipe messages where
 * "Delete Swipe" is not rendered, or no popup is currently open at all).
 *
 * @returns {{ popup: Element, deleteSwipeBtn: Element } | null}
 */
function findDeletionPopup() {
    // ST's Popup class appends '.popup' divs to <body>.
    // Older callGenericPopup used '#dialogue_popup'.
    // We query both to cover all ST versions.
    const allPopups = document.querySelectorAll('.popup, #dialogue_popup');

    for (const popup of allPopups) {
        // Skip hidden popups
        const style = window.getComputedStyle(popup);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        // Walk every button-like element inside the popup
        const btns = popup.querySelectorAll('.menu_button, button, [role="button"]');
        for (const btn of btns) {
            if (/delete\s+swipe/i.test(btn.textContent)) {
                return { popup, deleteSwipeBtn: btn };
            }
        }
    }
    return null;
}

/**
 * Find the "Cancel" button inside a popup.
 * We locate it by text so we can programmatically close the popup
 * after the user chooses our action.
 *
 * @param {Element} popup
 * @returns {Element | null}
 */
function findCancelButton(popup) {
    const btns = popup.querySelectorAll('.menu_button, button, [role="button"]');
    for (const btn of btns) {
        if (/^cancel$/i.test(btn.textContent.trim())) return btn;
    }
    return null;
}


// =============================================================================
//  Core logic — delete all swipes except the active one
// =============================================================================

/**
 * Removes every swipe from `chat[messageId]` except the currently displayed
 * swipe, then persists the chat and minimally updates the DOM counter.
 * The right-chevron (swipe_right) is intentionally left untouched so that
 * ST can still generate new swipes on this message afterwards.
 *
 * @param {number} messageId  Zero-based index into context.chat[]
 * @returns {Promise<boolean>}  true on success, false if nothing was done
 */
async function deleteAllButCurrentSwipe(messageId) {
    const { chat } = SillyTavern.getContext();

    const message = chat[messageId];

    // -- Guard rails ----------------------------------------------------------
    if (!message) {
        toastr.error(`[${MODULE_NAME}] Message #${messageId} not found.`);
        return false;
    }
    if (!Array.isArray(message.swipes) || message.swipes.length <= 1) {
        toastr.info('Nothing to remove — this message only has one swipe.');
        return false;
    }

    // -- Identify what to keep ------------------------------------------------
    // swipe_id is the 0-based index of the currently displayed swipe
    const keepIdx = message.swipe_id ?? 0;
    const removed = message.swipes.length - 1;    // how many we'll delete

    // -- Trim every swipe-related array to a single element -------------------
    //
    // ST stores parallel arrays for each swipe:
    //   .swipes      — the actual text of each swipe
    //   .swipe_info  — metadata per swipe (send_date, gen_started, gen_finished, …)
    //   .swipe_extra — extra AI-provider metadata (some versions)
    //
    message.swipes = [message.swipes[keepIdx]];

    if (Array.isArray(message.swipe_info)) {
        message.swipe_info = [message.swipe_info[keepIdx] ?? {}];
    } else {
        message.swipe_info = [];
    }

    // swipe_extra is present in newer ST versions; guard with a presence check
    if (Object.prototype.hasOwnProperty.call(message, 'swipe_extra') &&
        Array.isArray(message.swipe_extra)) {
        message.swipe_extra = [message.swipe_extra[keepIdx] ?? {}];
        }

        // Reset the index and keep .mes in sync with the surviving swipe
        message.swipe_id = 0;
    message.mes      = message.swipes[0];

    // -- Persist --------------------------------------------------------------
    await saveCurrentChat();

    // -- Update the DOM -------------------------------------------------------
    // Patch only the affected message element — no full chat reload needed.
    //
    // IMPORTANT: we must NOT disable .swipe_right.  In ST the right chevron
    // doubles as a "generate new swipe" trigger when you are already on the
    // last swipe.  Disabling it would prevent the user from ever swiping again
    // on this message.  We leave both arrow elements entirely in ST's hands and
    // only update the counter text so the display is immediately accurate.
    //
    // The left arrow is hidden by ST itself whenever swipe_id === 0, so we
    // just ensure that class is present; ST will re-show it if the user
    // generates another swipe and navigates back.
    const $mes = $(`#chat .mes[mesid="${messageId}"]`);
    if ($mes.length) {
        // Update the counter to "1/1" — ST uses a space-padded slash format.
        $mes.find('.swipes-counter').text('1/1');

        // Hide the back-arrow since there is nothing to navigate back to.
        // We deliberately do NOT touch .swipe_right — ST owns its enabled state.
        $mes.find('.swipe_left').addClass('swipe_left_disabled');

        // Exit the message editing field automatically, mirroring what ST's
        // native "Delete Swipe" does.  Clicking .mes_edit_cancel is equivalent
        // to the user pressing the ✕ button — it collapses the edit textarea
        // and restores the rendered message view without altering any content.
        $mes.find('.mes_edit_cancel').trigger('click');
    }

    toastr.success(
        `Removed ${removed} extra swipe${removed === 1 ? '' : 's'}. ` +
        `Swipe #${keepIdx + 1} is now the only swipe on this message.`
    );
    return true;
}


// =============================================================================
//  Popup injection — non-invasive augmentation of ST's deletion prompt
// =============================================================================

/**
 * Injects the "Delete All But This Swipe" button into ST's message-deletion
 * popup immediately after the existing "Delete Swipe" button.
 *
 * Called via setTimeout(0) after the .mes_edit_delete click so that ST's own
 * jQuery handler has already run and created the popup by the time we look for it.
 *
 * @param {number} msgId  The message whose delete button was clicked
 */
function injectPopupButton(msgId) {
    // -- Bail out if we already injected into this popup instance -------------
    if (document.querySelector(`[${INJECTED_ATTR}]`)) return;

    // -- Only inject when the message actually has multiple swipes ------------
    const { chat } = SillyTavern.getContext();
    const message  = chat[msgId];
    if (!message?.swipes || message.swipes.length <= 1) return;

    // -- Find the deletion popup ----------------------------------------------
    const found = findDeletionPopup();
    if (!found) {
        // Popup may not be ready yet on very fast machines — retry once after
        // another tick.  We only retry once to avoid an infinite loop.
        setTimeout(() => injectPopupButtonOnce(msgId), 50);
        return;
    }

    _doInject(found.popup, found.deleteSwipeBtn, msgId);
}

/** Internal: retry wrapper (called at most once). */
function injectPopupButtonOnce(msgId) {
    const found = findDeletionPopup();
    if (!found) return;    // truly not there — message might have only 1 swipe
    _doInject(found.popup, found.deleteSwipeBtn, msgId);
}

/** Internal: actually build and insert the button. */
function _doInject(popup, deleteSwipeBtn, msgId) {
    // Build our button, styled to match ST's existing .menu_button elements
    const btn = document.createElement('div');
    btn.className = 'menu_button menu_button_icon abts-delete-all-but-swipe';
    btn.setAttribute(INJECTED_ATTR, 'true');
    btn.setAttribute('tabindex', '0');
    btn.title = 'Keep the currently displayed swipe and permanently remove all others';
    btn.innerHTML =
    '<i class="fa-solid fa-broom"></i>' +
    ' Delete All But This Swipe';

    btn.addEventListener('click', async () => {
        // Close ST's popup gracefully via the Cancel button so ST can clean up
        // any internal state (focus traps, backdrop, etc.)
        const cancelBtn = findCancelButton(popup);
        if (cancelBtn) {
            cancelBtn.click();
        } else {
            // Fallback: click outside the popup (some ST versions dismiss on blur)
            popup.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }

        // A brief pause lets ST finish its popup teardown before we update chat
        await new Promise(resolve => setTimeout(resolve, 30));

        await deleteAllButCurrentSwipe(msgId);
    });

    // Also support keyboard activation (Enter / Space)
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            btn.click();
        }
    });

    // Position: immediately after "Delete Swipe", before "Cancel"
    deleteSwipeBtn.insertAdjacentElement('afterend', btn);

    console.debug(`[${MODULE_NAME}] Injected button into deletion popup for message #${msgId}`);
}


// =============================================================================
//  Hook into ST's message-delete button
// =============================================================================

/**
 * We use jQuery event delegation on the document so the handler works for
 * dynamically rendered messages. We deliberately do NOT call
 * stopImmediatePropagation — ST's own handler must still fire so it creates
 * the deletion popup; we inject into that popup on the next tick.
 */
function setupDeleteInterceptor() {
    $(document).on('click', '.mes_edit_delete', function () {
        const msgId = parseInt($(this).closest('.mes').attr('mesid'), 10);
        if (!isNaN(msgId)) {
            // Allow ST's handler to run first, then inject into the resulting popup
            setTimeout(() => injectPopupButton(msgId), 0);
        }
    });
}


// =============================================================================
//  /keepswipe slash command
// =============================================================================

/**
 * Slash-command callback: deletes all swipes except the active one on the
 * most recent AI message.
 *
 * Usage:  /keepswipe
 * Returns the 0-based message ID that was processed, or '' on failure.
 */
async function keepSwipeCallback(_namedArgs, _value) {
    const { chat } = SillyTavern.getContext();

    // Walk backwards to find the last non-user, non-system message
    let targetId = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user && !chat[i].is_system) {
            targetId = i;
            break;
        }
    }

    if (targetId === -1) {
        toastr.error(`[${MODULE_NAME}] No AI message found in the current chat.`);
        return '';
    }

    const success = await deleteAllButCurrentSwipe(targetId);
    return success ? String(targetId) : '';
}

function registerSlashCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'keepswipe',
//        aliases: ['delotherswipes'],
        callback: keepSwipeCallback,
        returns: 'the 0-based message ID that was operated on, or an empty string on failure',
        unnamedArgumentList: [],   // no arguments — always targets the last AI message
        helpString: `
        <div>
        Deletes every swipe on the last AI message <em>except</em> the one
        currently displayed, then saves the chat. Functionally identical to
        clicking <strong>"Delete All But This Swipe"</strong> in the message
        deletion popup.
        </div>
        <div style="margin-top: .4em">
        <strong>Example:</strong>
        <ul>
        <li>
        <pre><code class="language-stscript">/keepswipe</code></pre>
        Trims all excess swipes from the last AI message, keeping only
        whichever swipe is currently shown.
        </li>
        </ul>
        </div>
        <div style="margin-top: .4em; font-style: italic; font-size: .9em;">
        Note: this command only operates on the last AI message. If you need
        to clean swipes on a different message, use the GUI button in the
        chat instead.
        </div>
        `,
    }));
}


// =============================================================================
//  /cleanallswipes slash command
// =============================================================================

/**
 * Trims excess swipes from every AI message in the entire chat history in one
 * pass, keeping only the currently active swipe (swipe_id) for each message.
 *
 * This is the retroactive, whole-chat counterpart to /keepswipe, which only
 * operates on the last AI message.  Middle-of-history messages whose swipe
 * controls are hidden by ST are cleaned just as thoroughly as the last message.
 *
 * A single saveCurrentChat() call is made after all messages are processed so
 * we don't hammer the disk with one save per message.
 *
 * DOM updates are made only for the last AI message (the only one whose swipe
 * counter is both visible and interactive).  History messages have their swipe
 * controls hidden by ST's own CSS, so patching their DOM elements is unnecessary.
 *
 * @returns {Promise<string>}  Human-readable summary, also returned to STscript pipe.
 */
async function cleanAllSwipes() {
    const { chat } = SillyTavern.getContext();

    if (!chat || chat.length === 0) {
        toastr.warning(`[${MODULE_NAME}] No active chat found.`);
        return '';
    }

    let messagesAffected = 0;
    let totalRemoved     = 0;
    const affectedIds    = [];    // every mesid we cleaned, in order

    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];

        // Skip user turns and system messages — they never have swipe arrays.
        if (message.is_user || message.is_system) continue;

        // Skip messages that don't have a meaningful swipes array.
        if (!Array.isArray(message.swipes) || message.swipes.length <= 1) continue;

        const keepIdx = message.swipe_id ?? 0;
        const removed = message.swipes.length - 1;

        // -- Trim all three parallel swipe arrays to the single kept element ---
        message.swipes = [message.swipes[keepIdx]];

        if (Array.isArray(message.swipe_info)) {
            message.swipe_info = [message.swipe_info[keepIdx] ?? {}];
        } else {
            message.swipe_info = [];
        }

        if (Object.prototype.hasOwnProperty.call(message, 'swipe_extra') &&
            Array.isArray(message.swipe_extra)) {
            message.swipe_extra = [message.swipe_extra[keepIdx] ?? {}];
        }

        // Reset swipe pointer and keep .mes in sync with the surviving swipe.
        message.swipe_id = 0;
        message.mes      = message.swipes[0];

        messagesAffected++;
        totalRemoved += removed;
        affectedIds.push(i);

        console.debug(
            `[${MODULE_NAME}] /cleanallswipes — message #${i}: ` +
            `kept swipe ${keepIdx}, removed ${removed}`
        );
    }

    // -- Nothing to do --------------------------------------------------------
    if (messagesAffected === 0) {
        toastr.info('No excess swipes found — the chat history is already clean.');
        return 'clean';
    }

    // -- Persist once for the entire pass -------------------------------------
    await saveCurrentChat();

    // -- DOM patch for every affected message ---------------------------------
    // ST bakes the counter text into each message's DOM element at render time
    // and does not refresh it for history messages.  If the user later deletes
    // subsequent messages and a cleaned history message becomes the last active
    // message again, ST reveals that same DOM element — stale counter and all.
    // We therefore update the counter on EVERY message we cleaned, not just the
    // last one, so the value is always correct regardless of when it reappears.
    //
    // The swipe_left / mes_edit_cancel treatment still applies only to the tail
    // message: those interactions are only meaningful for the active last message.
    const lastAffectedId = affectedIds[affectedIds.length - 1];

    for (const id of affectedIds) {
        const $mes = $(`#chat .mes[mesid="${id}"]`);
        if (!$mes.length) continue;

        // Correct the counter text for every cleaned message.
        $mes.find('.swipes-counter').text('1/1');

        // Arrow and editor cleanup only for the last (tail) message.
        if (id === lastAffectedId) {
            $mes.find('.swipe_left').addClass('swipe_left_disabled');
            $mes.find('.mes_edit_cancel').trigger('click');
        }
    }

    // -- Report ---------------------------------------------------------------
    const summary =
        `Cleaned ${messagesAffected} message${messagesAffected === 1 ? '' : 's'}, ` +
        `removed ${totalRemoved} excess swipe${totalRemoved === 1 ? '' : 's'} ` +
        `across the chat history.`;

    toastr.success(summary);
    console.log(`[${MODULE_NAME}] /cleanallswipes complete — ${summary}`);
    return summary;
}

/**
 * Registers /cleanallswipes (alias: /delallswipes) with the ST slash-command
 * parser.  No arguments — it always operates on the full active chat history.
 */
function registerCleanAllSwipesCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cleanallswipes',
        aliases: ['delallswipes'],
        callback: async (_namedArgs, _value) => cleanAllSwipes(),
        returns: 'a summary string describing how many messages and swipes were cleaned, or "clean" if nothing needed removing',
        unnamedArgumentList: [],
        helpString: `
            <div>
                Scans the <em>entire</em> active chat history and removes all excess
                swipes from every AI message, keeping only the swipe that was active
                (<code>swipe_id</code>) at the time each message was last left. Saves
                the chat once after the full pass completes.
            </div>
            <div style="margin-top: .4em">
                This is the retroactive, whole-history counterpart to
                <code>/keepswipe</code>, which only targets the last AI message.
                Use <code>/cleanallswipes</code> to bulk-clean a long chat that
                accumulated unused swipes across many messages before this extension
                was installed.
            </div>
            <div style="margin-top: .4em">
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code class="language-stscript">/cleanallswipes</code></pre>
                        Trims every AI message in the chat to its single active swipe
                        and saves. Reports how many messages and swipes were affected.
                    </li>
                </ul>
            </div>
            <div style="margin-top: .4em; font-style: italic; font-size: .9em;">
                Note: this operation is permanent and cannot be undone without
                restoring a backup. ST's automatic chat backups (if enabled) are
                your safety net. The active swipe on every message is always
                preserved — no visible content is ever removed.
            </div>
        `,
    }));
}


// =============================================================================
//  Initialization
// =============================================================================

(function init() {
    setupDeleteInterceptor();
    registerSlashCommand();
    registerCleanAllSwipesCommand();
    console.log(`[${MODULE_NAME}] Extension loaded — "Delete All But This Swipe" is active.`);
})();
