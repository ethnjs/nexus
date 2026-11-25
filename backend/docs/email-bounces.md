# Bounces and complaints

SES reports permanent bounces and spam complaints to NEXUS, which stops emailing those addresses. This page covers how that works and the AWS setup it needs.

## How it works

- `_send()` sends through the configuration set named by `SES_CONFIGURATION_SET`. The set publishes `Bounce` and `Complaint` events to an SNS topic.
- SNS posts each event to `POST /webhooks/ses/` (`app/api/routes/webhooks.py`). The route has no API key, since SNS can't send one. Instead it accepts only the topic in `SES_SNS_TOPIC_ARN` and checks the SNS signature (`app/core/sns.py`).
- `record_ses_event()` (`app/core/email_suppression.py`) stores the address in `email_suppressions`:
  - A **permanent bounce** blocks every email to the address, and sets `email_verified = False` on its user.
  - A **complaint** blocks only staff invites, the one email the recipient didn't ask for. Codes, resets, email-change confirmations, and security notices still go out.
  - A transient bounce is ignored, since SES retries it.
- `send_in_background()` skips a bounced address and returns `False`. The code routes then answer with `email_undeliverable: true`, and the sign-in page tells the user to contact support.
- A bounced user can still sign in with a one-time code from the admin users page. An admin code doesn't mark the email verified, since it proves nothing about the mailbox.
- Admins see a badge on the user and can choose **Allow email again** (`DELETE /admin/users/{id}/email-suppression/`). That deletes the NEXUS row and the address's entry in the SES account suppression list.

## AWS setup

Do this once per AWS account, in the region in `AWS_REGION`.

1. **Account suppression list: bounces only.** If it also suppresses complaints, SES drops the codes and resets that NEXUS still sends to complainers.

   ```bash
   aws sesv2 put-account-suppression-attributes --suppressed-reasons BOUNCE
   ```

2. **SNS topic**, signed with SHA256:

   ```bash
   aws sns create-topic --name nexus-ses-events
   aws sns set-topic-attributes --topic-arn <topic arn> --attribute-name SignatureVersion --attribute-value 2
   ```

3. **Configuration set** with an SNS event destination for `BOUNCE` and `COMPLAINT`, pointing at the topic:

   ```bash
   aws sesv2 create-configuration-set --configuration-set-name nexus-events
   aws sesv2 create-configuration-set-event-destination \
     --configuration-set-name nexus-events \
     --event-destination-name sns \
     --event-destination '{"Enabled": true, "MatchingEventTypes": ["BOUNCE", "COMPLAINT"], "SnsDestination": {"TopicArn": "<topic arn>"}}'
   ```

4. **Backend environment variables:** set `SES_CONFIGURATION_SET=nexus-events` and `SES_SNS_TOPIC_ARN=<topic arn>`, then deploy.
5. **Subscribe the backend** to the topic over HTTPS at its public URL, with the trailing slash. The backend confirms the subscription itself and logs `Confirmed SNS subscription`.

   ```bash
   aws sns subscribe --topic-arn <topic arn> --protocol https --notification-endpoint https://<backend host>/webhooks/ses/
   ```

6. **IAM:** the keys in `AWS_ACCESS_KEY_ID` need `ses:SendEmail` and `ses:DeleteSuppressedDestination`.

## Testing it

Send to the SES mailbox simulator, which works in the sandbox and doesn't count against your reputation:

- `bounce@simulator.amazonses.com` should add a `bounce` row.
- `complaint@simulator.amazonses.com` should add a `complaint` row.

A staff invite to each address is an easy way to send one. Then check `email_suppressions`, or the backend logs for `SES permanent bounce` and `SES complaint`.
