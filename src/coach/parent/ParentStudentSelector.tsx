import React from "react";
import type { ParentStudentRow } from "../../types/parent";

export function formatStudentLabel(student: ParentStudentRow | null) {
  if (!student) return "학생";
  const email = String(student.email || "").trim();
  const localPart = email.split("@")[0]?.trim();
  return localPart || email || `학생 ${student.id}`;
}

export function ParentStudentSelector(props: {
  parentStudents: ParentStudentRow[];
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
}) {
  const selectedStudent =
    props.parentStudents.find(student => student.id === props.parentStudentId) ||
    props.parentStudents[0] ||
    null;

  if (props.parentStudents.length === 0) {
    return null;
  }

  return (
    <div className="coach-student-switcher" role="region" aria-label="관리 학생 선택">
      <div className="store-filter-row" role="tablist" aria-label="관리 학생 목록">
        {props.parentStudents.map(student => {
          const isSelected = student.id === selectedStudent?.id;
          return (
            <button
              key={student.id}
              type="button"
              role="tab"
              className={
                "store-filter-btn" + (isSelected ? " store-filter-btn--active" : "")
              }
              aria-selected={isSelected}
              aria-label={`${formatStudentLabel(student)} 학생 선택`}
              onClick={() => props.setParentStudentId(student.id)}
            >
              {formatStudentLabel(student)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
