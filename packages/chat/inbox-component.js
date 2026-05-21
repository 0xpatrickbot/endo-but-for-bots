// @ts-check

/** @import { ERef } from '@endo/far' */
/** @import { EndoHost } from '@endo/daemon' */

import { E } from '@endo/far';
import { makeRefIterator } from './ref-iterator.js';
import { playChime } from './chime.js';
import {
  prepareTextWithPlaceholders,
  renderMarkdown,
} from './markdown-render.js';
import { colorize } from './monaco-wrapper.js';
import {
  dateFormatter,
  timeFormatter,
  relativeTime,
} from './time-formatters.js';
import { render as renderValue } from './value-render.js';

/**
 * Compare two locator URLs by identity (node + id), ignoring address
 * hints (`at` params) that vary between `locate()` and message fields.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
const locatorsMatch = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.hostname === ub.hostname &&
      ua.searchParams.get('id') === ub.searchParams.get('id')
    );
  } catch {
    return false;
  }
};

/**
 * @param {HTMLElement} $parent
 * @param {HTMLElement | null} $end
 * @param {ERef<EndoHost>} powers
 * @param {{ showValue: (value: unknown, id?: string, petNamePath?: string[], messageContext?: { number: bigint, edgeName: string }) => void | Promise<void>, conversationId?: string | null, conversationPetName?: string | null }} options
 */
export const inboxComponent = async (
  $parent,
  $end,
  powers,
  { showValue, conversationId, conversationPetName },
) => {
  $parent.scrollTo(0, $parent.scrollHeight);

  /** Map from form messageId to its description, for value message rendering. */
  /** @type {Map<string, string>} */
  const formDescriptions = new Map();
  /** @type {Map<string, Array<{name: string, secret: boolean}>>} */
  const formFieldMeta = new Map();

  // Schedule a hard scroll-to-bottom shortly after messages start arriving.
  // The existing message backlog arrives rapidly via the iterator; this
  // timer fires once the initial batch has been rendered, ensuring the
  // user lands at the latest message when switching to the inbox.
  // eslint-disable-next-line no-unused-vars
  let initialScrollTimer = setTimeout(() => {
    $parent.scrollTo(0, $parent.scrollHeight);
    initialScrollTimer = 0;
  }, 150);

  const selfLocator = await E(powers).locate('@self');

  /**
   * Track the rendered `.message-envelope` element for each message number we
   * have already seen.  When the daemon emits a revision of an existing
   * message (via `editMessage`), `followMessages` re-emits the same number
   * with a new envelope; we swap the existing DOM node in place rather than
   * appending a duplicate.  Cleared when a message is dismissed.
   *
   * @type {Map<string, HTMLElement>}
   */
  const envelopeByNumber = new Map();

  /**
   * Track whether any revision history is known for a given message number,
   * so the "view history" affordance can be hidden until at least one edit
   * has been observed.
   *
   * @type {Set<string>}
   */
  const editedNumbers = new Set();

  for await (const message of makeRefIterator(E(powers).followMessages())) {
    // Read DOM at animation frame to determine whether to pin scroll to bottom
    // of the messages pane. Use 80px tolerance (matching channel-component)
    // so short messages don't cause the user to "lose" auto-scroll.
    const wasAtEnd = await new Promise(resolve =>
      requestAnimationFrame(() => {
        const scrollTop = /** @type {number} */ ($parent.scrollTop);
        const endScrollTop = /** @type {number} */ (
          $parent.scrollHeight - $parent.clientHeight
        );
        resolve(endScrollTop - scrollTop < 80);
      }),
    );

    const { number, from: fromId, to: toId, date, dismissed } = message;

    const isSent = locatorsMatch(fromId, selfLocator);

    if (conversationId) {
      const otherPartyId = isSent ? toId : fromId;
      if (!locatorsMatch(otherPartyId, conversationId)) {
        // Self-to-self messages (e.g. endow result delivery) belong to a
        // conversation when their replyTo references a message already in
        // this conversation thread.
        const replyTo =
          'replyTo' in message
            ? /** @type {string} */ (message.replyTo)
            : undefined;
        const isSelfReplyInThread =
          locatorsMatch(fromId, selfLocator) &&
          locatorsMatch(toId, selfLocator) &&
          replyTo &&
          $parent.querySelector(
            `.message-envelope[data-message-id="${CSS.escape(replyTo)}"]`,
          );
        let matchesByPetName = false;
        if (!isSelfReplyInThread && conversationPetName) {
          // ID didn't match directly — try matching by pet name
          // (handles peer/remote/guest formula indirection)
          // eslint-disable-next-line no-await-in-loop
          const names = await E(powers).reverseLocate(otherPartyId);
          const leafName = Array.isArray(conversationPetName)
            ? conversationPetName[conversationPetName.length - 1]
            : conversationPetName;
          matchesByPetName =
            Array.isArray(names) &&
            names.includes(
              /** @type {import('@endo/daemon').Name} */ (leafName),
            );
        }
        if (!isSelfReplyInThread && !matchesByPetName) {
          // Message does not belong to this conversation; skip it.
          // (Wrapping the rest of the loop body would add excessive
          // indentation, so we use a guarded skip instead.)
          // eslint-disable-next-line no-continue
          continue;
        }
      }
    }

    const numberKey = String(number);
    const isRevision = envelopeByNumber.has(numberKey);
    if (isRevision) {
      editedNumbers.add(numberKey);
    }

    const $envelope = document.createElement('div');
    $envelope.className = 'message-envelope';
    $envelope.dataset.number = numberKey;
    if (message.messageId) {
      $envelope.dataset.messageId = String(message.messageId);
    }
    if (message.replyTo) {
      $envelope.dataset.replyTo = String(message.replyTo);
    }

    // `done` defaults to true on legacy emissions; only emissions explicitly
    // marked `done: false` are partial submissions.
    const isPending =
      'done' in message &&
      /** @type {{done?: boolean}} */ (message).done === false;
    if (isPending) {
      $envelope.classList.add('message-envelope-pending');
    }
    if (editedNumbers.has(numberKey)) {
      $envelope.classList.add('message-envelope-edited');
    }

    const $message = document.createElement('div');
    $message.className = isSent ? 'message sent' : 'message';

    const $error = document.createElement('span');
    $error.style.color = 'red';
    $error.innerText = '';

    dismissed.then(() => {
      $envelope.remove();
      envelopeByNumber.delete(numberKey);
      editedNumbers.delete(numberKey);
    });

    const parsedDate = new Date(date);
    const $timestamp = document.createElement('span');
    $timestamp.className = 'timestamp';
    $timestamp.innerText = timeFormatter.format(parsedDate);

    const $tooltip = document.createElement('span');
    $tooltip.className = 'timestamp-tooltip';

    const $controls = document.createElement('span');
    $controls.className = 'timestamp-controls';

    const $msgNum = document.createElement('span');
    $msgNum.className = 'timestamp-num';
    $msgNum.innerText = `#${number}`;
    $controls.appendChild($msgNum);

    const $dismiss = document.createElement('button');
    $dismiss.className = 'dismiss-button';
    $dismiss.innerText = '×';
    $dismiss.title = 'Dismiss';
    $dismiss.onclick = () => {
      E(powers)
        .dismiss(number)
        .catch(error => {
          $error.innerText = ` ${error.message}`;
        });
    };
    $controls.appendChild($dismiss);

    // Edit and history controls are populated below for package messages
    // that the local agent sent.  They are attached here so they live in
    // the timestamp tooltip alongside the dismiss button.
    /** @type {HTMLButtonElement | null} */
    let $editButton = null;
    /** @type {HTMLButtonElement | null} */
    let $historyButton = null;
    if (isSent && message.type === 'package') {
      $historyButton = document.createElement('button');
      $historyButton.className = 'history-button';
      $historyButton.type = 'button';
      $historyButton.innerText = '⏱';
      $historyButton.title = 'View edit history';
      // Hidden until at least one revision has been observed.
      $historyButton.style.display = editedNumbers.has(numberKey) ? '' : 'none';
      $controls.appendChild($historyButton);

      $editButton = document.createElement('button');
      $editButton.className = 'edit-button';
      $editButton.type = 'button';
      $editButton.innerText = '✎';
      $editButton.title = 'Edit message';
      // Hidden while the message is still settling.  An agent that wants
      // to amend a not-yet-done message can do so via `editMessage`
      // directly; the UI only exposes the affordance on settled messages
      // to avoid racing with the sender's own streaming update.
      $editButton.style.display = isPending ? 'none' : '';
      $controls.appendChild($editButton);
    }

    $tooltip.appendChild($controls);

    const $times = document.createElement('span');
    $times.className = 'timestamp-times';
    const relative = relativeTime(parsedDate);
    const timeLines = [date, dateFormatter.format(parsedDate), relative].filter(
      Boolean,
    );
    for (const line of timeLines) {
      const $line = document.createElement('div');
      $line.className = 'timestamp-line';

      const $text = document.createElement('span');
      $text.innerText = line;
      $line.appendChild($text);

      const $copy = document.createElement('span');
      $copy.className = 'timestamp-copy';
      $copy.innerText = '⧉';
      $line.appendChild($copy);

      $line.onclick = () => {
        navigator.clipboard.writeText(line).then(() => {
          $copy.innerText = '✓';
          setTimeout(() => {
            $copy.innerText = '⧉';
          }, 1000);
        });
      };

      $times.appendChild($line);
    }
    $tooltip.appendChild($times);

    $timestamp.appendChild($tooltip);
    $message.appendChild($timestamp);

    const $body = document.createElement('div');
    $body.className = 'message-body';
    $body.appendChild($error);
    $message.appendChild($body);

    // Create sender/recipient chip to be injected into message content
    /** @type {HTMLElement | null} */
    let $senderChip = null;
    if (!isSent) {
      const fromNames = await E(powers).reverseLocate(fromId);
      const fromName = fromNames?.[0];
      if (fromName !== undefined) {
        $senderChip = document.createElement('b');
        $senderChip.innerText = `@${fromName}`;
      }
    } else {
      const toNames = await E(powers).reverseLocate(toId);
      const toName = toNames?.[0];
      if (toName !== undefined) {
        $senderChip = document.createElement('b');
        $senderChip.innerText = `@${toName}`;
      }
    }

    if (message.type === 'request') {
      const { description, settled } = message;

      const $description = document.createElement('span');
      // Inject sender chip before the description text
      if ($senderChip) {
        $description.appendChild($senderChip);
        $description.appendChild(document.createTextNode(' '));
      }
      $description.appendChild(
        document.createTextNode(JSON.stringify(description)),
      );
      $body.appendChild($description);

      const $input = document.createElement('span');
      $body.appendChild($input);

      const $pet = document.createElement('input');
      $pet.autocomplete = 'off';
      $pet.dataset.formType = 'other';
      $pet.dataset.lpignore = 'true';
      $input.appendChild($pet);

      const $resolve = document.createElement('button');
      $resolve.innerText = 'resolve';
      $input.appendChild($resolve);

      const $reject = document.createElement('button');
      $reject.innerText = 'reject';
      $reject.onclick = () => {
        E(powers).reject(number, $pet.value).catch(window.reportError);
      };
      $input.appendChild($reject);

      $resolve.onclick = () => {
        E(powers)
          .resolve(number, $pet.value)
          .catch(error => {
            $error.innerText = ` ${error.message}`;
          });
      };

      settled.then(status => {
        $input.innerText = ` ${status} `;
      });
    } else if (message.type === 'package') {
      const { strings, names } = message;
      assert(Array.isArray(strings));
      assert(Array.isArray(names));

      // Prepare text with placeholders for markdown rendering
      const textWithPlaceholders = prepareTextWithPlaceholders(strings);
      const { fragment, insertionPoints, highlight } = renderMarkdown(
        textWithPlaceholders,
        { colorize },
      );

      // Inject sender chip into the first paragraph or heading
      // But NOT into code fence wrappers or lists - prepend a new paragraph instead
      if ($senderChip) {
        // Find first element that's a plain paragraph (not code fence wrapper) or heading
        const $firstPara = fragment.querySelector(
          'p:not(.md-code-fence-wrapper), h1, h2, h3, h4, h5, h6',
        );
        const $firstChild = fragment.firstChild;
        const isCodeFenceOrList =
          $firstChild &&
          (($firstChild instanceof Element &&
            $firstChild.classList.contains('md-code-fence-wrapper')) ||
            ($firstChild instanceof Element && $firstChild.tagName === 'UL') ||
            ($firstChild instanceof Element && $firstChild.tagName === 'OL'));

        if ($firstPara && !isCodeFenceOrList) {
          // Insert into existing paragraph or heading
          $firstPara.insertBefore(
            document.createTextNode(' '),
            $firstPara.firstChild,
          );
          $firstPara.insertBefore($senderChip, $firstPara.firstChild);
        } else {
          // Prepend a new paragraph for the chip
          const $chipPara = document.createElement('p');
          $chipPara.className = 'md-paragraph';
          $chipPara.appendChild($senderChip);
          fragment.insertBefore($chipPara, fragment.firstChild);
        }
      }

      // Append the rendered markdown
      $body.appendChild(fragment);

      // Asynchronously apply Monaco syntax highlighting to code fences
      highlight();

      // Create token chips for each insertion point
      for (
        let index = 0;
        index < Math.min(insertionPoints.length, names.length);
        index += 1
      ) {
        assert.typeof(names[index], 'string');
        const edgeName = names[index];
        const $slot = insertionPoints[index];

        const $token = document.createElement('span');
        $token.className = 'token';
        $token.tabIndex = 0;
        $token.setAttribute('role', 'button');
        $token.title = 'Open value';

        const $name = document.createElement('b');
        $name.innerText = `@${edgeName}`;
        $token.appendChild($name);

        const updateHoverTitle = async () => {
          const id = message.ids?.[index];
          if (!id) return;
          try {
            const petNames = await E(powers).reverseLocate(id);
            if (Array.isArray(petNames) && petNames.length > 0) {
              $token.title = petNames.join(', ');
            }
          } catch {
            // Keep default title on failure.
          }
        };

        const openValue = async () => {
          const valueId = message.ids?.[index];
          if (!valueId) {
            $error.innerText = ' Value not available';
            return;
          }
          try {
            const value = await E(powers).lookupById(valueId);
            // Pass message context for title display
            showValue(value, valueId, undefined, { number, edgeName });
          } catch (error) {
            $error.innerText = ` ${/** @type {Error} */ (error).message}`;
          }
        };

        $token.addEventListener('click', () => {
          openValue();
        });

        $token.addEventListener('keydown', event => {
          if (event.repeat || event.metaKey) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openValue();
          }
        });

        updateHoverTitle();

        // Replace the placeholder slot with the token
        $slot.replaceWith($token);
      }
    } else if (message.type === 'definition') {
      const { source, slots } = message;
      assert(typeof source === 'string');

      const $definition = document.createElement('div');
      $definition.className = 'definition-message';

      // Sender chip
      if ($senderChip) {
        const $chipLine = document.createElement('div');
        $chipLine.className = 'definition-from';
        $chipLine.appendChild($senderChip);
        $chipLine.appendChild(document.createTextNode(' proposes to define:'));
        $definition.appendChild($chipLine);
      }

      // Source code
      const $codeWrapper = document.createElement('div');
      $codeWrapper.className = 'md-paragraph md-code-fence-wrapper';
      const $pre = document.createElement('pre');
      $pre.className = 'md-code-fence';
      const $label = document.createElement('span');
      $label.className = 'md-code-fence-language';
      $label.textContent = 'javascript';
      $pre.appendChild($label);
      const $code = document.createElement('code');
      $code.className = 'language-javascript';
      $code.dataset.language = 'javascript';
      $code.textContent = source;
      colorize(source, 'javascript').then(
        html => {
          $code.innerHTML = html;
        },
        () => {
          // colorize failed — keep plain text
        },
      );
      $pre.appendChild($code);
      $codeWrapper.appendChild($pre);
      $definition.appendChild($codeWrapper);

      // Slot bindings
      const slotEntries = Object.entries(
        /** @type {Record<string, { label: string }>} */ (slots),
      );
      /** @type {Record<string, HTMLInputElement>} */
      const slotInputs = {};

      if (slotEntries.length > 0) {
        const $slotsSection = document.createElement('div');
        $slotsSection.className = 'definition-slots';

        const $slotsLabel = document.createElement('div');
        $slotsLabel.className = 'definition-slots-label';
        $slotsLabel.textContent = 'Slots to fill:';
        $slotsSection.appendChild($slotsLabel);

        const $slotsList = document.createElement('div');
        $slotsList.className = 'definition-slots-list';

        for (const [codeName, { label }] of slotEntries) {
          const $row = document.createElement('div');
          $row.className = 'definition-slot-row';

          const $codeName = document.createElement('code');
          $codeName.textContent = codeName;
          $row.appendChild($codeName);

          const $arrow = document.createElement('span');
          $arrow.textContent = ' ← ';
          $row.appendChild($arrow);

          const $input = document.createElement('input');
          $input.type = 'text';
          $input.className = 'definition-slot-input';
          $input.placeholder = label;
          $row.appendChild($input);
          slotInputs[codeName] = $input;

          $slotsList.appendChild($row);
        }
        $slotsSection.appendChild($slotsList);
        $definition.appendChild($slotsSection);
      }

      // Actions
      const $actions = document.createElement('div');
      $actions.className = 'definition-actions';

      if (!isSent) {
        const doSubmit = () => {
          /** @type {Record<string, string>} */
          const bindings = {};
          for (const [codeName, $input] of Object.entries(slotInputs)) {
            const val = $input.value.trim();
            if (!val) {
              $error.innerText = ` Missing binding for ${codeName}`;
              return;
            }
            bindings[codeName] = val;
          }
          $error.innerText = '';
          E(powers)
            .endow(number, bindings)
            .catch(error => {
              $error.innerText = ` ${error.message}`;
            });
        };

        // Enter key in any slot input submits the form
        for (const $input of Object.values(slotInputs)) {
          $input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSubmit();
            }
          });
        }

        const $submit = document.createElement('button');
        $submit.className = 'definition-submit';
        $submit.textContent = 'Submit';
        $submit.onclick = doSubmit;
        $actions.appendChild($submit);
      }

      $definition.appendChild($actions);
      $body.appendChild($definition);
    } else if (message.type === 'form') {
      const { description, fields, messageId: formMsgId } = message;
      formDescriptions.set(String(formMsgId), String(description));
      formFieldMeta.set(
        String(formMsgId),
        fields.map(f => ({
          name: /** @type {{name: string}} */ (f).name,
          secret: /** @type {{secret?: boolean}} */ (f).secret === true,
        })),
      );

      const $form = document.createElement('div');
      $form.className = 'form-request-message';

      // Sender chip + description
      const $desc = document.createElement('div');
      $desc.className = 'form-request-description';
      if ($senderChip) {
        $desc.appendChild($senderChip);
        $desc.appendChild(document.createTextNode(' '));
      }
      $desc.appendChild(
        document.createTextNode(
          `${isSent ? 'form' : 'sent form'}: ${JSON.stringify(description)}`,
        ),
      );
      $form.appendChild($desc);

      // Show fields as read-only list
      const $fieldsContainer = document.createElement('div');
      $fieldsContainer.className = 'form-request-fields';

      const fieldArray =
        /** @type {Array<{name: string, label: string, example?: string, default?: string, secret?: boolean}>} */ (
          fields
        );

      /** @type {Record<string, HTMLInputElement>} */
      const fieldInputs = {};
      for (const field of fieldArray) {
        const $row = document.createElement('div');
        $row.className = 'form-request-field-row';

        const $label = document.createElement('label');
        $label.className = 'form-request-field-label';
        $label.textContent = field.label || field.name;

        const $input = document.createElement('input');
        $input.type = field.secret ? 'password' : 'text';
        $input.className = 'form-request-field-input';
        $input.placeholder = field.example || field.name;
        if (field.default) {
          $input.value = field.default;
        }
        $input.autocomplete = 'off';
        $input.dataset.formType = 'other';
        $input.dataset.lpignore = 'true';

        fieldInputs[field.name] = $input;
        $row.appendChild($label);

        if (field.secret) {
          const $group = document.createElement('div');
          $group.className = 'form-field-input-group';
          $group.appendChild($input);

          const $toggle = document.createElement('button');
          $toggle.type = 'button';
          $toggle.className = 'form-field-toggle';
          $toggle.textContent = 'Show';
          $toggle.onclick = () => {
            const hidden = $input.type === 'password';
            $input.type = hidden ? 'text' : 'password';
            $toggle.textContent = hidden ? 'Hide' : 'Show';
          };
          $group.appendChild($toggle);

          const $copy = document.createElement('button');
          $copy.type = 'button';
          $copy.className = 'form-field-copy';
          $copy.textContent = 'Copy';
          $copy.onclick = () => {
            navigator.clipboard.writeText($input.value);
            $copy.textContent = 'Copied';
            setTimeout(() => {
              $copy.textContent = 'Copy';
            }, 1500);
          };
          $group.appendChild($copy);

          $row.appendChild($group);
        } else {
          $row.appendChild($input);
        }
        $fieldsContainer.appendChild($row);
      }
      $form.appendChild($fieldsContainer);

      // Actions
      const $actions = document.createElement('div');
      $actions.className = 'form-request-actions';

      const $submitBtn = document.createElement('button');
      $submitBtn.className = 'form-request-submit';
      $submitBtn.textContent = 'Submit';
      const submitForm = () => {
        /** @type {Record<string, string>} */
        const values = {};
        for (const field of fieldArray) {
          values[field.name] = fieldInputs[field.name].value;
        }
        E(powers)
          .submit(number, values)
          .catch(err => {
            $error.innerText = ` ${/** @type {Error} */ (err).message}`;
          });
      };
      $submitBtn.onclick = submitForm;
      $actions.appendChild($submitBtn);

      $fieldsContainer.addEventListener(
        'keydown',
        /** @param {KeyboardEvent} e */ e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitForm();
          }
        },
      );

      $form.appendChild($actions);

      $body.appendChild($form);
    } else if (message.type === 'value') {
      const { valueId } = message;
      const valueReplyTo = /** @type {string | undefined} */ (
        'replyTo' in message ? message.replyTo : undefined
      );
      const formTitle =
        valueReplyTo !== undefined
          ? formDescriptions.get(String(valueReplyTo))
          : undefined;

      const $valueMsg = document.createElement('div');
      $valueMsg.className = 'form-request-message';

      const $desc = document.createElement('div');
      $desc.className = 'form-request-description';
      if ($senderChip) {
        $desc.appendChild($senderChip);
        $desc.appendChild(document.createTextNode(' '));
      }
      const responseText =
        formTitle !== undefined
          ? `responded to form: ${JSON.stringify(formTitle)}`
          : 'responded to form';
      $desc.appendChild(document.createTextNode(responseText));
      $valueMsg.appendChild($desc);

      // Render the value inline
      const $inlineValue = document.createElement('div');
      $inlineValue.className = 'form-request-inline-value';
      $valueMsg.appendChild($inlineValue);

      const fieldMeta =
        valueReplyTo !== undefined
          ? formFieldMeta.get(String(valueReplyTo))
          : undefined;
      const secretFieldNames = new Set(
        (fieldMeta || []).filter(f => f.secret).map(f => f.name),
      );

      E(powers)
        .lookupById(valueId)
        .then(
          value => {
            if (
              secretFieldNames.size > 0 &&
              value !== null &&
              typeof value === 'object'
            ) {
              const record = /** @type {Record<string, unknown>} */ (value);
              const $fields = document.createElement('div');
              $fields.className = 'form-request-fields';
              for (const key of Object.keys(record)) {
                const $row = document.createElement('div');
                $row.className = 'form-request-field-row';

                const $label = document.createElement('span');
                $label.className = 'form-request-field-label';
                $label.textContent = key;
                $row.appendChild($label);

                if (secretFieldNames.has(key)) {
                  const $group = document.createElement('div');
                  $group.className = 'form-field-input-group';

                  const $masked = document.createElement('span');
                  $masked.className = 'form-value-secret';
                  $masked.textContent =
                    '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
                  $group.appendChild($masked);

                  const realValue = String(record[key]);

                  const $toggle = document.createElement('button');
                  $toggle.type = 'button';
                  $toggle.className = 'form-field-toggle';
                  $toggle.textContent = 'Show';
                  $toggle.onclick = () => {
                    const isHidden = $masked.textContent !== realValue;
                    $masked.textContent = isHidden
                      ? realValue
                      : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
                    $toggle.textContent = isHidden ? 'Hide' : 'Show';
                  };
                  $group.appendChild($toggle);

                  const $copy = document.createElement('button');
                  $copy.type = 'button';
                  $copy.className = 'form-field-copy';
                  $copy.textContent = 'Copy';
                  $copy.onclick = () => {
                    navigator.clipboard.writeText(realValue);
                    $copy.textContent = 'Copied';
                    setTimeout(() => {
                      $copy.textContent = 'Copy';
                    }, 1500);
                  };
                  $group.appendChild($copy);

                  $row.appendChild($group);
                } else {
                  $row.appendChild(renderValue(record[key]));
                }
                $fields.appendChild($row);
              }
              $inlineValue.appendChild($fields);
            } else {
              $inlineValue.appendChild(renderValue(value));
            }
          },
          (/** @type {Error} */ err) => {
            $inlineValue.innerText = `Error: ${err.message}`;
          },
        );

      // Show Value button for closer inspection
      const $actions = document.createElement('div');
      $actions.className = 'form-request-actions';
      const $showResult = document.createElement('button');
      $showResult.className = 'form-request-show-result';
      $showResult.textContent = 'Show Value';
      $showResult.title = 'Inspect the submitted value';
      $showResult.addEventListener('click', () => {
        E(powers)
          .lookupById(valueId)
          .then(
            value => {
              showValue(value, valueId, undefined, {
                number,
                edgeName: 'value',
              });
            },
            (/** @type {Error} */ err) => {
              $error.innerText = ` ${err.message}`;
            },
          );
      });
      $actions.appendChild($showResult);
      $valueMsg.appendChild($actions);

      $body.appendChild($valueMsg);
    }

    $envelope.appendChild($message);

    // Wire up the edit and history controls now that the message body has
    // been rendered.  The controls were appended to the timestamp tooltip
    // earlier so they appear in the same place across all package messages.
    if (
      $editButton &&
      message.type === 'package' &&
      Array.isArray(message.strings) &&
      Array.isArray(message.names)
    ) {
      const initialText = message.strings.join('');
      const currentEdgeNames = /** @type {string[]} */ (message.names);
      const currentIds = /** @type {string[]} */ (message.ids ?? []);
      $editButton.onclick = () => {
        // Toggle the inline editor: if one is already mounted, the click
        // closes it.
        const $existing = $envelope.querySelector('.edit-editor');
        if ($existing) {
          $existing.remove();
          $editButton.innerText = '✎';
          return;
        }
        const $editor = document.createElement('div');
        $editor.className = 'edit-editor';

        const $textarea = document.createElement('textarea');
        $textarea.className = 'edit-input';
        $textarea.value = initialText;
        $editor.appendChild($textarea);

        const $actions = document.createElement('div');
        $actions.className = 'edit-actions';

        const $submit = document.createElement('button');
        $submit.type = 'button';
        $submit.className = 'edit-submit';
        $submit.textContent = 'Save';
        $submit.onclick = () => {
          const text = $textarea.value;
          // Preserve token positions when the edited text still contains
          // every existing `@edgeName` reference; otherwise drop the
          // bindings whose tokens were removed.  This keeps the simple
          // text-only edit path one-call, while still permitting an agent
          // to issue a richer edit programmatically.
          const keptEdgeNames = currentEdgeNames.filter(name =>
            text.includes(`@${name}`),
          );
          const keptIds = keptEdgeNames.map(name => {
            const index = currentEdgeNames.indexOf(name);
            return currentIds[index];
          });
          // The daemon validates `strings.length >= petNames.length`; a
          // single-string payload satisfies that for any number of bindings.
          E(powers)
            .editMessage(number, [text], keptEdgeNames, keptIds)
            .then(
              () => {
                $editor.remove();
                $editButton.innerText = '✎';
              },
              (/** @type {Error} */ err) => {
                $error.innerText = ` ${err.message}`;
              },
            );
        };
        $actions.appendChild($submit);

        const $cancel = document.createElement('button');
        $cancel.type = 'button';
        $cancel.className = 'edit-cancel';
        $cancel.textContent = 'Cancel';
        $cancel.onclick = () => {
          $editor.remove();
          $editButton.innerText = '✎';
        };
        $actions.appendChild($cancel);

        $editor.appendChild($actions);
        $message.appendChild($editor);
        $editButton.innerText = '×';
        $textarea.focus();
      };
    }

    if ($historyButton) {
      $historyButton.onclick = () => {
        const $existing = $envelope.querySelector('.history-panel');
        if ($existing) {
          $existing.remove();
          return;
        }
        const $panel = document.createElement('div');
        $panel.className = 'history-panel';
        $panel.textContent = 'Loading history…';
        $message.appendChild($panel);
        E(powers)
          .messageHistory(number)
          .then(
            (/** @type {unknown} */ revisions) => {
              $panel.textContent = '';
              const $list = document.createElement('ol');
              $list.className = 'history-list';
              const revisionArray =
                /** @type {Array<{envelope?: {strings?: string[]}, done?: boolean, date?: string}>} */ (
                  Array.isArray(revisions) ? revisions : []
                );
              for (const revision of revisionArray) {
                const $item = document.createElement('li');
                $item.className = 'history-item';
                const strings = Array.isArray(revision.envelope?.strings)
                  ? revision.envelope.strings.join('')
                  : '';
                const stamp = revision.date ? `[${revision.date}] ` : '';
                const doneTag = revision.done === false ? ' (partial)' : '';
                $item.textContent = `${stamp}${strings}${doneTag}`;
                $list.appendChild($item);
              }
              $panel.appendChild($list);
            },
            (/** @type {Error} */ err) => {
              $panel.textContent = `Error: ${err.message}`;
            },
          );
      };
    }

    // Insert or replace.  A re-emission carries the same number; swap the
    // existing envelope in place so the user does not see a duplicate.
    const $previous = envelopeByNumber.get(numberKey);
    if ($previous && $previous.parentElement === $parent) {
      $parent.replaceChild($envelope, $previous);
    } else {
      $parent.insertBefore($envelope, $end);
    }
    envelopeByNumber.set(numberKey, $envelope);

    if (
      !isSent &&
      !isRevision &&
      Date.now() - new Date(date).getTime() < 2000
    ) {
      playChime();
    }

    if (wasAtEnd) {
      $parent.scrollTo(0, $parent.scrollHeight);
    }
  }
};
