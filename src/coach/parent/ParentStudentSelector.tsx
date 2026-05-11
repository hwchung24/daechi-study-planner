import React, { useEffect, useRef, useState } from "react";
import type { ParentStudentRow } from "../../types/parent";

export function formatStudentLabel(student: ParentStudentRow | null) {
  if (!student) return "학생";
  const name = String(student.name || "").trim();
  if (name) return name;
  const email = String(student.email || "").trim();
  const localPart = email.split("@")[0]?.trim();
  return localPart || email || `학생 ${student.id}`;
}

export function ParentStudentSelector(props: {
  parentStudents: ParentStudentRow[];
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedStudent =
    props.parentStudents.find(student => student.id === props.parentStudentId) ||
    props.parentStudents[0] ||
    null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (props.parentStudents.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className="coach-student-switcher" role="region" aria-label="관리 학생 선택">
      <div className="parent-student-dropdown">
        <button
          type="button"
          className="parent-quick-nav__btn parent-student-dropdown__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(prev => !prev)}
        >
          <span>{formatStudentLabel(selectedStudent)}</span>
          <span className="parent-student-dropdown__caret" aria-hidden>
            {open ? "▲" : "▼"}
          </span>
        </button>
        {open ? (
          <div className="parent-student-dropdown__menu" role="listbox" aria-label="관리 학생 목록">
            {props.parentStudents.map(student => {
              const isSelected = student.id === selectedStudent?.id;
              return (
                <button
                  key={student.id}
                  type="button"
                  className={
                    "parent-student-dropdown__item" +
                    (isSelected ? " parent-student-dropdown__item--active" : "")
                  }
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    props.setParentStudentId(student.id);
                    setOpen(false);
                  }}
                >
                  <span className="parent-student-dropdown__item-label">
                    {formatStudentLabel(student)}
                  </span>
                  {isSelected ? (
                    <span className="parent-student-dropdown__item-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
