// @ts-check

import harden from '@endo/harden';

/**
 * @typedef {object} PendingCommandEntry
 * @property {string} id
 * @property {string} commandName
 * @property {Record<string, unknown>} params
 * @property {number} startTime
 * @property {'pending' | 'success' | 'error'} status
 * @property {string} [errorMessage]
 * @property {HTMLElement} $card
 */

/**
 * @typedef {object} CommandResultShape
 * @property {boolean} success
 * @property {unknown} [value]
 * @property {string} [message]
 * @property {Error} [error]
 */

/**
 * @typedef {object} PendingCommandsAPI
 * @property {(commandName: string, params: Record<string, unknown>, promise: Promise<CommandResultShape>) => void} track
 * @property {() => number} count
 */

/**
 * Create the pending commands region.
 *
 * @param {HTMLElement} $container - Element to append pending cards to.
 * @returns {PendingCommandsAPI}
 */
export const createPendingCommands = $container => {
  /** @type {Map<string, PendingCommandEntry>} */
  const entries = new Map();

  let nextId = 0;

  /**
   * Format command params for display.
   * @param {string} commandName
   * @param {Record<string, unknown>} params
   * @returns {string}
   */
  const formatCommand = (commandName, params) => {
    const parts = [`/${commandName}`];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '' && key !== 'messageNumber') {
        parts.push(String(value));
      }
    }
    if (params.messageNumber !== undefined) {
      parts.unshift(`#${params.messageNumber}`);
    }
    return parts.join(' ');
  };

  /**
   * Create a card element for a pending command.
   * @param {string} id
   * @param {string} commandName
   * @param {Record<string, unknown>} params
   * @returns {HTMLElement}
   */
  const createCard = (id, commandName, params) => {
    const $card = document.createElement('div');
    $card.className = 'pending-command-card pending';
    $card.dataset.pendingId = id;

    const $label = document.createElement('span');
    $label.className = 'pending-command-label';
    $label.textContent = formatCommand(commandName, params);
    $card.appendChild($label);

    const $spinner = document.createElement('span');
    $spinner.className = 'pending-command-spinner';
    $card.appendChild($spinner);

    const $status = document.createElement('span');
    $status.className = 'pending-command-status';
    $card.appendChild($status);

    return $card;
  };

  /**
   * Transition a card to the success state and fade it out.
   * @param {string} id
   * @param {PendingCommandEntry} entry
   * @param {HTMLElement} $card
   */
  const transitionToSuccess = (id, entry, $card) => {
    entry.status = 'success';
    $card.classList.remove('pending');
    $card.classList.add('success');
    const $status = $card.querySelector('.pending-command-status');
    if ($status) $status.textContent = '✓';
    // Fade out after a brief display.
    setTimeout(() => {
      $card.classList.add('fade-out');
      setTimeout(() => {
        $card.remove();
        entries.delete(id);
        if (entries.size === 0) {
          $container.classList.remove('has-pending');
        }
      }, 300);
    }, 1500);
  };

  /**
   * Transition a card to the error state. The card remains visible
   * until the user clicks it.
   * @param {string} id
   * @param {PendingCommandEntry} entry
   * @param {HTMLElement} $card
   * @param {string} message
   */
  const transitionToError = (id, entry, $card, message) => {
    entry.status = 'error';
    entry.errorMessage = message;
    $card.classList.remove('pending');
    $card.classList.add('error');
    const $status = $card.querySelector('.pending-command-status');
    if ($status) {
      $status.textContent = message;
    }
    // Error cards stay until clicked.
    $card.addEventListener(
      'click',
      () => {
        $card.classList.add('fade-out');
        setTimeout(() => {
          $card.remove();
          entries.delete(id);
          if (entries.size === 0) {
            $container.classList.remove('has-pending');
          }
        }, 300);
      },
      { once: true },
    );
  };

  /**
   * Track a command execution. Shows a pending card immediately and
   * transitions it on completion. The executor returns a
   * `{ success, error?, message? }` shape and catches its own errors,
   * so the promise normally resolves; success vs. error keys off the
   * resolved `success` field rather than promise rejection. A rejection
   * handler remains as a defense-in-depth for unexpected throws that
   * escape the executor's catch.
   *
   * @param {string} commandName
   * @param {Record<string, unknown>} params
   * @param {Promise<CommandResultShape>} promise
   */
  const track = (commandName, params, promise) => {
    nextId += 1;
    const id = `pending-${nextId}`;
    const $card = createCard(id, commandName, params);

    /** @type {PendingCommandEntry} */
    const entry = {
      id,
      commandName,
      params,
      startTime: Date.now(),
      status: 'pending',
      $card,
    };
    entries.set(id, entry);
    $container.appendChild($card);
    $container.classList.add('has-pending');

    promise.then(
      result => {
        if (result && result.success) {
          transitionToSuccess(id, entry, $card);
        } else {
          const message =
            (result && result.error && result.error.message) ||
            (result && result.message) ||
            'Command failed';
          transitionToError(id, entry, $card, message);
        }
      },
      error => {
        // Defense-in-depth: the executor normally catches its own
        // errors and returns { success: false, ... }, but a thrown
        // rejection that escapes still surfaces here.
        transitionToError(
          id,
          entry,
          $card,
          /** @type {Error} */ (error).message,
        );
      },
    );
  };

  return harden({
    track,
    count: () => entries.size,
  });
};
