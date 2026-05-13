"use strict";

const { getKoFallbacks } = require("./koFallbackLoader");

function snap() {
  return getKoFallbacks().studentCoachSnapshot;
}

/**
 * @param {{ sleep: number; conc: number; stress: number; plan: number; steps: number }} m
 *   `avg()`로 뽑은 최근 로그 평균
 */
function pickCoachHeroNarrative(m) {
  const s = snap();
  const sleep = Number(m.sleep) || 0;
  const conc = Number(m.conc) || 0;
  const stress = Number(m.stress) || 0;
  const plan = Number(m.plan) || 0;
  const steps = Number(m.steps) || 0;

  let hero = s.defaultHero;
  if (sleep > 0 && sleep < 6.2 && conc > 0 && conc < 3.2) {
    hero = s.heroSleepConc;
  } else if (stress >= 3.8) {
    hero = s.heroStress;
  } else if (plan > 0 && plan < 60) {
    hero = s.heroLowPlan;
  } else if (steps > 0 && steps < 3000) {
    hero = s.heroLowSteps;
  }
  return hero;
}

/** @param {{ sleep: number; conc: number; stress: number; plan: number; steps: number }} m */
function pickCoachNextActions(m) {
  const s = snap();
  const sleep = Number(m.sleep) || 0;
  const stress = Number(m.stress) || 0;
  const plan = Number(m.plan) || 0;
  const nextActions = [...s.defaultNextActions];
  if (sleep > 0 && sleep < 6.2) nextActions[0] = s.nextActionSleep;
  if (plan > 0 && plan < 60) nextActions[1] = s.nextActionLowPlan;
  if (stress >= 3.8) nextActions[2] = s.nextActionStress;
  return nextActions;
}

const s0 = getKoFallbacks().studentCoachSnapshot;
const defaultFirstNextAction = s0.defaultNextActions[0];
const DEFAULT_NEXT_ACTIONS = s0.defaultNextActions;

module.exports = {
  pickCoachHeroNarrative,
  pickCoachNextActions,
  defaultFirstNextAction,
  DEFAULT_NEXT_ACTIONS
};
