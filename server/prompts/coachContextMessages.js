"use strict";

/** 코치 채팅·일정 검증 등: DB/프로필/일정을 system 메시지로 감싸기 */

function wrapCoachDbContextJson(coachDbContextJson) {
  return `학생 DB 컨텍스트(JSON): ${coachDbContextJson}`;
}

function wrapExistingSchedules(existingSchedules) {
  return `현재 등록된 일정 목록: ${JSON.stringify(existingSchedules || [])}`;
}

function wrapStudentProfileSnapshot(snapshot) {
  return `학생 프로필/요약: ${JSON.stringify(snapshot || {})}`;
}

module.exports = {
  wrapCoachDbContextJson,
  wrapExistingSchedules,
  wrapStudentProfileSnapshot
};
