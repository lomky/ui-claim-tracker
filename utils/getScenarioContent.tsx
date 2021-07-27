/**
 * Utility file for returning the correct content for each scenario.
 *
 * Scenarios are referred to by number and the numbers match the content spreadsheet from
 * UIB. The ScenarioType enum is a numeric enum so that we can take advantage of the
 * built-in Typescript reverse mapping for numeric enums. However, we set the long-form
 * description in ScenarioTypeNames for easy(ish) reference.
 */

import { Claim, ClaimDetailsContent, PendingDetermination, ScenarioContent } from '../types/common'
import getClaimDetails from './getClaimDetails'
import getClaimStatus from './getClaimStatus'
import { isDatePast, isValidDate, parseConvertDate } from './formatDate'
import { isFirstTimeSlotEarlier } from './timeSlot'

export enum ScenarioType {
  Scenario1,
  Scenario2,
  Scenario3,
  Scenario4,
  Scenario5,
  Scenario6,
}

export const ScenarioTypeNames = {
  [ScenarioType.Scenario1]: 'Determination interview: not yet scheduled',
  [ScenarioType.Scenario2]: 'Determination interview: scheduled',
  [ScenarioType.Scenario3]: 'Determination interview: awaiting decision',
  [ScenarioType.Scenario4]: 'Generic pending state: pending weeks',
  [ScenarioType.Scenario5]: 'Base state: no pending weeks, no weeks to certify',
  [ScenarioType.Scenario6]: 'Base state: no pending weeks, weeks to certify',
}

interface PendingDeterminationScenario {
  scenarioType: ScenarioType
  pendingDetermination?: PendingDetermination
}

export const NonPendingDeterminationValues = ['Canceled', 'Complete', 'TRAN', 'INVL', 'IDNC', '1277', 'OTHR', 'ClmCX']

/**
 * Determine whether the Determination Status is pending.
 *
 * Determination Status is considered pending if:
 * either DeterminationStatus is blank (NULL)
 * OR DeterminationStatus is neither "Canceled" nor "Complete" nor "TRAN" nor
 *   "INVL" nor "IDNC" nor "1277" nor "OTHR" nor "ClmCX"
 */
export function isDeterminationStatusPending(pendingDetermination: PendingDetermination): boolean {
  return (
    !pendingDetermination.determinationStatus ||
    !NonPendingDeterminationValues.includes(pendingDetermination.determinationStatus)
  )
}

/**
 * Identify whether the first pendingDetermination object is scheduled before the second object.
 *
 * If both arguments are scheduled at the same time, this will return false.
 * Assumes that dates have already been checked for validity.
 */
export function isScheduledStrictlyBefore(first: PendingDetermination, second: PendingDetermination): boolean {
  const firstScheduleDate = parseConvertDate(first.scheduleDate)
  const secondScheduleDate = parseConvertDate(second.scheduleDate)

  // If the first appointment is scheduled before the second.
  if (firstScheduleDate < secondScheduleDate) {
    return true
  }
  // If the first appointment is scheduled after the second.
  else if (firstScheduleDate > secondScheduleDate) {
    return false
  }
  // If both appointments are on the same date...
  else {
    // ...then compare the time slots.
    const isEarlier = isFirstTimeSlotEarlier(first.timeSlotDesc, second.timeSlotDesc)

    // It's possible for both time slots to be improperly formatted, in which case it doesn't
    // matter which appointment is said to be first, since they are on the same date.
    if (!isEarlier) {
      return false
    }
    // Otherwise, return the appointment with the earlier time slot start time.
    else {
      return isEarlier
    }
  }
}

/**
 * Identify whether the scenario is one of the pending determination scenarios.
 */
export function identifyPendingDeterminationScenario(
  pendingDeterminations: PendingDetermination[],
): PendingDeterminationScenario | null {
  let earliestScheduled: PendingDetermination | null = null

  // Track whether any of the pendingDetermination objects meet the other scenario criteria.
  let hasAwaitingDecision = false
  let hasNotYetScheduled = false

  // Loop through all the pendingDetermination objects.
  for (const pendingDetermination of pendingDeterminations) {
    if (isDeterminationStatusPending(pendingDetermination) && isValidDate(pendingDetermination.scheduleDate)) {
      // Scenario 2:
      // If Determination Status is Pending
      // AND Schedule Date is today or in the future
      if (!isDatePast(parseConvertDate(pendingDetermination.scheduleDate))) {
        // If we haven't found a pendingDetermination object that is scheduled yet
        // OR the current pendingDetermination object is earlier than the previous one found
        // Then update the earliest found scheduled pendingDetermination object
        if (!earliestScheduled || isScheduledStrictlyBefore(pendingDetermination, earliestScheduled)) {
          earliestScheduled = pendingDetermination
        }
      }
      // Scenario 3:
      // If Determination Status is Pending
      // AND Schedule Date is in the past
      else {
        hasAwaitingDecision = true
      }
    }
    // Scenario 1:
    // If determinationStatus is empty/null/undefined/unset
    // AND scheduleDate has no value
    // AND requestDate has a value
    else if (
      !pendingDetermination.determinationStatus &&
      !pendingDetermination.scheduleDate &&
      pendingDetermination.requestDate
    ) {
      hasNotYetScheduled = true
    }
    // All other combinations are invalid!
  }

  // Scenarios 2 takes priority over Scenarios 1 & 3.
  if (earliestScheduled) {
    return {
      scenarioType: ScenarioType.Scenario2,
      pendingDetermination: earliestScheduled,
    }
  } else {
    // Scenario 3 takes priority over Scenario 1.
    if (hasAwaitingDecision) {
      return { scenarioType: ScenarioType.Scenario3 }
    } else if (hasNotYetScheduled) {
      return { scenarioType: ScenarioType.Scenario1 }
    }
    // Otherwise, no valid pendingDetermination objects; return null.
    else {
      return null
    }
  }
}

/**
 * Identify the correct scenario to display.
 *
 * @TODO: Validating the API gateway response #150
 */
export function getScenario(claimData: Claim): PendingDeterminationScenario {
  // If there are any pendingDetermination objects, the scenario MIGHT be one of the
  // pending determination scenarios.
  if (claimData.pendingDetermination && claimData.pendingDetermination.length > 0) {
    const pendingDeterminationScenario = identifyPendingDeterminationScenario(claimData.pendingDetermination)

    // It's possible to have pending determination objects, but still not be a valid
    // pending determination scenario, so check to see if the returned object is null.
    if (pendingDeterminationScenario) {
      return pendingDeterminationScenario
    }
  }

  // If the scenario is not one of the Pending Determination scenarios,
  // check to see if it one of the remaining scenarios.

  // @TODO: Validate that hasPendingWeeks is a boolean
  if (claimData.hasPendingWeeks === true) {
    // @TODO: Validate that hasCertificationWeeks is a boolean
    return { scenarioType: ScenarioType.Scenario4 }
  }
  // hasPendingWeeks === false
  else {
    if (claimData.hasCertificationWeeksAvailable === false) {
      return { scenarioType: ScenarioType.Scenario5 }
    } else {
      return { scenarioType: ScenarioType.Scenario6 }
    }
  }
}

/**
 * Return whether the Claim Status should display the "continue certifying" content.
 */
export function continueCertifying(scenarioType: ScenarioType, claimData: Claim): boolean {
  // If the Scenario is not scenario 5 or 6
  // AND hasCertificationWeeksAvailable is true
  // Then we should display the "continue certifying" content.
  const isIgnoredScenario = [ScenarioType.Scenario5, ScenarioType.Scenario6].includes(scenarioType)
  if (!isIgnoredScenario && claimData.hasCertificationWeeksAvailable) {
    return true
  }
  // Otherwise, we should not display the "continue certifying" content.
  else {
    return false
  }
}

/*
 * Return scenario content.
 */
export default function getScenarioContent(claimData: Claim): ScenarioContent {
  // Get the scenario type.
  const scenarioTypeObject = getScenario(claimData)
  const scenarioType = scenarioTypeObject.scenarioType

  // Construct claim status content.
  const statusContent = getClaimStatus(scenarioType, continueCertifying(scenarioType, claimData))

  // Construct claim details content.
  if (!claimData.claimDetails) {
    throw new Error('Missing claim details')
  }
  const detailsContent: ClaimDetailsContent = getClaimDetails(claimData.claimDetails)

  const content: ScenarioContent = {
    statusContent: statusContent,
    detailsContent: detailsContent,
  }

  return content
}
